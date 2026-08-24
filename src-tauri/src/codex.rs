use serde::{Deserialize, Serialize};
use serde_json::json;
use std::{
    env, fs,
    io::Read,
    path::{Path, PathBuf},
    process::{Command, Stdio},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc,
    },
    thread,
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};
use tauri::State;

const MODEL: &str = "gpt-5.6-terra";
const REASONING: &str = "medium";
const SCHEMA_VERSION: u8 = 1;
const LOGIN_TIMEOUT: Duration = Duration::from_secs(10);
const ADVICE_TIMEOUT: Duration = Duration::from_secs(180);
const MAX_FEN_LENGTH: usize = 100;
const MAX_SAN_LENGTH: usize = 32;
const MAX_PV_PLIES: usize = 6;

#[derive(Default)]
pub struct CodexState {
    busy: Arc<AtomicBool>,
}

struct BusyGuard(Arc<AtomicBool>);

impl Drop for BusyGuard {
    fn drop(&mut self) {
        self.0.store(false, Ordering::SeqCst);
    }
}

impl CodexState {
    fn claim(&self) -> Result<BusyGuard, String> {
        self.busy
            .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
            .map(|_| BusyGuard(Arc::clone(&self.busy)))
            .map_err(|_| "codex_busy".to_string())
    }
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct CodexAdviceRequest {
    pub language: String,
    pub fen_before: String,
    pub fen_after: String,
    pub san: String,
    pub color: String,
    pub result: String,
    pub classification: String,
    pub reason: String,
    pub centipawn_loss: u32,
    pub before: String,
    pub after: String,
    pub best_move_san: Option<String>,
    pub principal_variation_san: Vec<String>,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CodexAdvice {
    pub summary: String,
    pub explanation: String,
    pub plan: String,
    pub practice: String,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct CodexAdviceResponse {
    pub schema_version: u8,
    pub advice: CodexAdvice,
    pub model: String,
    pub reasoning: String,
    pub duration_ms: u64,
}

struct TemporaryWorkspace {
    path: PathBuf,
}

impl TemporaryWorkspace {
    fn create() -> Result<Self, String> {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map_err(|_| "codex_execution_failed".to_string())?
            .as_nanos();
        let path = env::temp_dir().join(format!("chessmate-codex-{}-{nonce}", std::process::id()));
        fs::create_dir(&path).map_err(|_| "codex_execution_failed".to_string())?;
        Ok(Self { path })
    }
}

impl Drop for TemporaryWorkspace {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.path);
    }
}

fn validate_request(request: &CodexAdviceRequest) -> Result<(), String> {
    if !matches!(request.language.as_str(), "en" | "fr")
        || !matches!(request.color.as_str(), "white" | "black")
        || !matches!(request.result.as_str(), "1-0" | "0-1" | "1/2-1/2")
        || request.fen_before.is_empty()
        || request.fen_before.len() > MAX_FEN_LENGTH
        || request.fen_after.is_empty()
        || request.fen_after.len() > MAX_FEN_LENGTH
        || request.san.is_empty()
        || request.san.len() > MAX_SAN_LENGTH
        || !matches!(
            request.classification.as_str(),
            "brilliant"
                | "great"
                | "best"
                | "excellent"
                | "good"
                | "inaccuracy"
                | "mistake"
                | "miss"
                | "blunder"
        )
        || !matches!(
            request.reason.as_str(),
            "brilliantSacrifice"
                | "greatMate"
                | "greatRecovery"
                | "engineBest"
                | "missedWin"
                | "centipawnLoss"
        )
        || request.before.is_empty()
        || request.before.len() > 16
        || request.after.is_empty()
        || request.after.len() > 16
        || request
            .best_move_san
            .as_ref()
            .is_some_and(|san| san.is_empty() || san.len() > MAX_SAN_LENGTH)
        || request.principal_variation_san.len() > MAX_PV_PLIES
        || request
            .principal_variation_san
            .iter()
            .any(|san| san.is_empty() || san.len() > MAX_SAN_LENGTH)
    {
        return Err("codex_invalid_request".to_string());
    }
    Ok(())
}

fn response_schema() -> serde_json::Value {
    json!({
        "$schema": "https://json-schema.org/draft/2020-12/schema",
        "type": "object",
        "additionalProperties": false,
        "required": ["summary", "explanation", "plan", "practice"],
        "properties": {
            "summary": { "type": "string", "minLength": 1, "maxLength": 600 },
            "explanation": { "type": "string", "minLength": 1, "maxLength": 1200 },
            "plan": { "type": "string", "minLength": 1, "maxLength": 800 },
            "practice": { "type": "string", "minLength": 1, "maxLength": 600 }
        }
    })
}

fn build_prompt(request: &CodexAdviceRequest) -> Result<String, String> {
    validate_request(request)?;
    let facts = serde_json::to_string(request).map_err(|_| "codex_invalid_request".to_string())?;
    let language = if request.language == "fr" {
        "French"
    } else {
        "English"
    };
    Ok([
        "You are the optional Codex adviser inside ChessMate, a post-game chess review app.",
        "Use only the supplied facts. Stockfish evaluations, move rating, best move, and principal variation are authoritative.",
        "Never invent another engine line or claim a tactical motif as fact unless it is directly proven by the supplied legal SAN line.",
        "If you offer an interpretation beyond those facts, label it clearly as a hypothesis.",
        "Do not use tools, inspect files, run commands, or take any external action.",
        "Give concise, practical coaching for the player who made the move.",
        &format!("Write every response field in {language}."),
        "Return only the JSON object required by the output schema.",
        "",
        "Authoritative move facts:",
        &facts,
    ]
    .join("\n"))
}

fn parse_advice(output: &str) -> Result<CodexAdvice, String> {
    let advice: CodexAdvice =
        serde_json::from_str(output.trim()).map_err(|_| "codex_malformed_output".to_string())?;
    if advice.summary.trim().is_empty()
        || advice.summary.chars().count() > 600
        || advice.explanation.trim().is_empty()
        || advice.explanation.chars().count() > 1_200
        || advice.plan.trim().is_empty()
        || advice.plan.chars().count() > 800
        || advice.practice.trim().is_empty()
        || advice.practice.chars().count() > 600
    {
        return Err("codex_malformed_output".to_string());
    }
    Ok(advice)
}

fn existing_file(path: PathBuf) -> Option<PathBuf> {
    path.is_file().then_some(path)
}

fn discover_codex_cli() -> Result<PathBuf, String> {
    if let Some(configured) = env::var_os("CHESSMATE_CODEX_CLI") {
        return existing_file(PathBuf::from(configured))
            .ok_or_else(|| "codex_cli_missing".to_string());
    }

    #[cfg(windows)]
    {
        if let Some(profile) = env::var_os("USERPROFILE") {
            let candidate = PathBuf::from(profile)
                .join("Tools")
                .join("codex-cli")
                .join("node_modules")
                .join("@openai")
                .join("codex-win32-x64")
                .join("vendor")
                .join("x86_64-pc-windows-msvc")
                .join("bin")
                .join("codex.exe");
            if let Some(path) = existing_file(candidate) {
                return Ok(path);
            }
        }

        if let Ok(output) = Command::new("where.exe")
            .arg("codex.exe")
            .stdin(Stdio::null())
            .stderr(Stdio::null())
            .output()
        {
            if output.status.success() {
                if let Some(path) = String::from_utf8_lossy(&output.stdout)
                    .lines()
                    .map(str::trim)
                    .filter(|line| !line.is_empty())
                    .map(PathBuf::from)
                    .find(|path| path.is_file())
                {
                    return Ok(path);
                }
            }
        }
    }

    #[cfg(not(windows))]
    if let Ok(output) = Command::new("which")
        .arg("codex")
        .stdin(Stdio::null())
        .stderr(Stdio::null())
        .output()
    {
        if output.status.success() {
            if let Some(path) = existing_file(PathBuf::from(
                String::from_utf8_lossy(&output.stdout).trim(),
            )) {
                return Ok(path);
            }
        }
    }

    Err("codex_cli_missing".to_string())
}

fn run_process(path: &Path, args: &[String], timeout: Duration) -> Result<String, String> {
    let mut command = Command::new(path);
    command
        .args(args)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null());

    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x0800_0000);
    }

    let mut child = command
        .spawn()
        .map_err(|_| "codex_cli_missing".to_string())?;
    let mut stdout = child
        .stdout
        .take()
        .ok_or_else(|| "codex_execution_failed".to_string())?;
    let reader = thread::spawn(move || {
        let mut output = String::new();
        let _ = stdout.read_to_string(&mut output);
        output
    });
    let started = Instant::now();

    let status = loop {
        if let Some(status) = child
            .try_wait()
            .map_err(|_| "codex_execution_failed".to_string())?
        {
            break status;
        }
        if started.elapsed() >= timeout {
            let _ = child.kill();
            let _ = child.wait();
            let _ = reader.join();
            return Err("codex_timeout".to_string());
        }
        thread::sleep(Duration::from_millis(50));
    };
    let output = reader
        .join()
        .map_err(|_| "codex_execution_failed".to_string())?;
    if !status.success() {
        return Err("codex_execution_failed".to_string());
    }
    Ok(output)
}

fn verify_login(path: &Path) -> Result<(), String> {
    let args = vec!["login".to_string(), "status".to_string()];
    run_process(path, &args, LOGIN_TIMEOUT)
        .map(|_| ())
        .map_err(|error| {
            if error == "codex_timeout" {
                error
            } else if error == "codex_cli_missing" {
                error
            } else {
                "codex_not_logged_in".to_string()
            }
        })
}

fn run_advice_with(
    path: &Path,
    request: &CodexAdviceRequest,
    timeout: Duration,
) -> Result<CodexAdviceResponse, String> {
    let started = Instant::now();
    validate_request(request)?;
    verify_login(path)?;
    let workspace = TemporaryWorkspace::create()?;
    let schema_path = workspace.path.join("advice-schema.json");
    fs::write(
        &schema_path,
        serde_json::to_vec(&response_schema()).map_err(|_| "codex_execution_failed")?,
    )
    .map_err(|_| "codex_execution_failed".to_string())?;
    let prompt = build_prompt(request)?;
    let args = vec![
        "exec".to_string(),
        "--ephemeral".to_string(),
        "--ignore-user-config".to_string(),
        "--ignore-rules".to_string(),
        "--sandbox".to_string(),
        "read-only".to_string(),
        "--skip-git-repo-check".to_string(),
        "--disable".to_string(),
        "apps".to_string(),
        "--disable".to_string(),
        "browser_use".to_string(),
        "--disable".to_string(),
        "computer_use".to_string(),
        "--disable".to_string(),
        "hooks".to_string(),
        "--disable".to_string(),
        "image_generation".to_string(),
        "--disable".to_string(),
        "in_app_browser".to_string(),
        "--disable".to_string(),
        "multi_agent".to_string(),
        "--disable".to_string(),
        "shell_tool".to_string(),
        "--color".to_string(),
        "never".to_string(),
        "--model".to_string(),
        MODEL.to_string(),
        "-c".to_string(),
        format!("model_reasoning_effort=\"{REASONING}\""),
        "--output-schema".to_string(),
        schema_path.to_string_lossy().to_string(),
        "-C".to_string(),
        workspace.path.to_string_lossy().to_string(),
        prompt,
    ];
    let output = run_process(path, &args, timeout)?;
    let advice = parse_advice(&output)?;
    Ok(CodexAdviceResponse {
        schema_version: SCHEMA_VERSION,
        advice,
        model: MODEL.to_string(),
        reasoning: REASONING.to_string(),
        duration_ms: started.elapsed().as_millis().min(u64::MAX as u128) as u64,
    })
}

#[tauri::command]
pub async fn request_codex_advice(
    request: CodexAdviceRequest,
    state: State<'_, CodexState>,
) -> Result<CodexAdviceResponse, String> {
    let busy = state.claim()?;
    tauri::async_runtime::spawn_blocking(move || {
        let _busy = busy;
        let path = discover_codex_cli()?;
        run_advice_with(&path, &request, ADVICE_TIMEOUT)
    })
    .await
    .map_err(|_| "codex_execution_failed".to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;

    const FAKE_CODEX_SOURCE: &str = r##"
use std::{env, thread, time::Duration};

fn main() {
    let args: Vec<String> = env::args().collect();
    if args.get(1).map(String::as_str) == Some("login") {
        if args.iter().any(|arg| arg == "status") {
            println!("Logged in using ChatGPT");
            return;
        }
        std::process::exit(2);
    }
    let required = [
        "exec", "--ephemeral", "--ignore-user-config", "--ignore-rules",
        "--sandbox", "read-only", "--skip-git-repo-check", "--model",
        "apps", "browser_use", "computer_use", "hooks", "image_generation", "in_app_browser",
        "multi_agent", "shell_tool", "gpt-5.6-terra", "model_reasoning_effort=\"medium\"",
        "--output-schema", "-C",
    ];
    if required.iter().any(|expected| !args.iter().any(|arg| arg == expected)) {
        std::process::exit(3);
    }
    let prompt = args.last().map(String::as_str).unwrap_or_default();
    if prompt.contains("TIMEOUT") {
        thread::sleep(Duration::from_secs(2));
        return;
    }
    if prompt.contains("MALFORMED") {
        println!("not-json");
        return;
    }
    println!(r#"{{"summary":"Keep it","explanation":"Facts only.","plan":"Compare candidates.","practice":"Solve one position."}}"#);
}
"##;

    const FAKE_LOGGED_OUT_SOURCE: &str = r#"
fn main() {
    std::process::exit(1);
}
"#;

    fn rustc_command() -> PathBuf {
        if let Some(configured) = env::var_os("RUSTC") {
            return PathBuf::from(configured);
        }
        if let Some(profile) = env::var_os("USERPROFILE") {
            let candidate = PathBuf::from(profile)
                .join(".cargo")
                .join("bin")
                .join("rustc.exe");
            if candidate.is_file() {
                return candidate;
            }
        }
        if let Some(home) = env::var_os("HOME") {
            let candidate = PathBuf::from(home).join(".cargo").join("bin").join("rustc");
            if candidate.is_file() {
                return candidate;
            }
        }
        PathBuf::from("rustc")
    }

    fn compile_fake_codex(name: &str, source_contents: &str) -> (PathBuf, PathBuf) {
        let directory = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("target")
            .join(format!("fake-codex-{name}-{}", std::process::id()));
        fs::create_dir_all(&directory).unwrap();
        let source = directory.join("fake_codex.rs");
        let executable = directory.join(if cfg!(windows) {
            "fake_codex.exe"
        } else {
            "fake_codex"
        });
        fs::write(&source, source_contents).unwrap();
        let status = Command::new(rustc_command())
            .arg("--edition=2021")
            .arg(&source)
            .arg("-o")
            .arg(&executable)
            .status()
            .expect("rustc must compile the fake Codex CLI");
        assert!(status.success());
        (directory, executable)
    }

    fn request() -> CodexAdviceRequest {
        CodexAdviceRequest {
            language: "en".to_string(),
            fen_before: "rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2".to_string(),
            fen_after: "rnbqkbnr/pppp1ppp/8/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R b KQkq - 1 2".to_string(),
            san: "Nf3".to_string(),
            color: "white".to_string(),
            result: "1-0".to_string(),
            classification: "best".to_string(),
            reason: "engineBest".to_string(),
            centipawn_loss: 0,
            before: "+0.25".to_string(),
            after: "+0.25".to_string(),
            best_move_san: Some("Nf3".to_string()),
            principal_variation_san: vec!["Nf3".to_string(), "Nc6".to_string()],
        }
    }

    #[test]
    fn prompt_contains_only_the_bounded_move_contract() {
        let prompt = build_prompt(&request()).unwrap();
        assert!(prompt.contains("\"san\":\"Nf3\""));
        assert!(prompt.contains("\"fenBefore\""));
        assert!(!prompt.contains("rawPgn"));
        assert!(!prompt.contains("whitePlayer"));
        assert!(!prompt.contains("chess.com"));
        assert!(validate_request(&CodexAdviceRequest {
            principal_variation_san: vec!["e4".to_string(); 7],
            ..request()
        })
        .is_err());
    }

    #[test]
    fn parses_strict_bounded_json() {
        let valid = r#"{"summary":"Keep it","explanation":"The evaluation stayed level.","plan":"Repeat the comparison.","practice":"Find two candidates."}"#;
        assert_eq!(parse_advice(valid).unwrap().summary, "Keep it");
        assert_eq!(
            parse_advice("not json"),
            Err("codex_malformed_output".to_string())
        );
        assert!(
            parse_advice(r#"{"summary":"","explanation":"x","plan":"x","practice":"x"}"#).is_err()
        );
    }

    #[test]
    fn busy_guard_allows_only_one_request() {
        let state = CodexState::default();
        let first = state.claim().unwrap();
        assert!(matches!(state.claim(), Err(error) if error == "codex_busy"));
        drop(first);
        assert!(state.claim().is_ok());
    }

    #[test]
    fn fake_cli_covers_flags_success_timeout_malformed_and_login() {
        let (directory, executable) = compile_fake_codex("success", FAKE_CODEX_SOURCE);
        let response = run_advice_with(&executable, &request(), Duration::from_secs(2)).unwrap();
        assert_eq!(response.model, MODEL);
        assert_eq!(response.reasoning, REASONING);
        assert_eq!(response.advice.summary, "Keep it");

        let timeout_request = CodexAdviceRequest {
            san: "TIMEOUT".to_string(),
            ..request()
        };
        assert_eq!(
            run_advice_with(&executable, &timeout_request, Duration::from_millis(80)),
            Err("codex_timeout".to_string())
        );

        let malformed_request = CodexAdviceRequest {
            san: "MALFORMED".to_string(),
            ..request()
        };
        assert_eq!(
            run_advice_with(&executable, &malformed_request, Duration::from_secs(2)),
            Err("codex_malformed_output".to_string())
        );
        fs::remove_dir_all(directory).unwrap();

        let (logged_out_directory, logged_out) =
            compile_fake_codex("logged-out", FAKE_LOGGED_OUT_SOURCE);
        assert_eq!(
            run_advice_with(&logged_out, &request(), Duration::from_secs(2)),
            Err("codex_not_logged_in".to_string())
        );
        fs::remove_dir_all(logged_out_directory).unwrap();

        assert_eq!(
            run_process(
                Path::new("definitely-missing-chessmate-codex"),
                &[],
                Duration::from_millis(10)
            ),
            Err("codex_cli_missing".to_string())
        );
    }

    #[test]
    #[ignore = "uses the installed Codex CLI and ChatGPT subscription quota"]
    fn real_codex_smoke_returns_schema() {
        let path = discover_codex_cli().expect("Codex CLI must be installed");
        let response = run_advice_with(&path, &request(), ADVICE_TIMEOUT)
            .expect("Codex must return schema-valid advice");
        assert_eq!(response.schema_version, SCHEMA_VERSION);
        assert_eq!(response.model, MODEL);
        assert!(!response.advice.summary.is_empty());
    }
}
