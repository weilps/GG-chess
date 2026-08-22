use serde::{Deserialize, Serialize};
use std::{
    collections::HashMap,
    fs,
    io::{BufRead, BufReader, Write},
    path::{Path, PathBuf},
    process::{Child, ChildStdin, Command, Stdio},
    sync::{
        atomic::{AtomicBool, Ordering},
        mpsc::{self, Receiver, RecvTimeoutError},
        Arc, Mutex,
    },
    thread,
    time::{Duration, Instant},
};
use tauri::{Emitter, State};

const HANDSHAKE_TIMEOUT: Duration = Duration::from_secs(5);
const POSITION_TIMEOUT: Duration = Duration::from_secs(120);

#[derive(Default)]
pub struct EngineState {
    cancellations: Arc<Mutex<HashMap<String, Arc<AtomicBool>>>>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EngineInfo {
    pub path: String,
    pub name: String,
    pub version: String,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PositionEvaluation {
    pub position_index: usize,
    pub score_cp: Option<i32>,
    pub mate: Option<i32>,
    pub depth: u32,
    pub best_move: Option<String>,
    pub pv: Vec<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AnalyzeRequest {
    pub analysis_id: String,
    pub engine_path: String,
    pub depth: u32,
    pub positions: Vec<String>,
    pub position_indexes: Vec<usize>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AnalyzeResponse {
    pub evaluations: Vec<PositionEvaluation>,
    pub cancelled: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct AnalysisProgress {
    analysis_id: String,
    current: usize,
    total: usize,
    evaluation: PositionEvaluation,
}

#[derive(Debug, Default, Clone, PartialEq)]
struct ParsedInfo {
    depth: u32,
    score_cp: Option<i32>,
    mate: Option<i32>,
    pv: Vec<String>,
}

struct UciSession {
    child: Child,
    stdin: ChildStdin,
    lines: Receiver<String>,
}

impl UciSession {
    fn spawn(path: &Path) -> Result<Self, String> {
        let mut command = Command::new(path);
        command
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::null());

        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            command.creation_flags(0x0800_0000);
        }

        let mut child = command
            .spawn()
            .map_err(|_| "engine_not_found".to_string())?;
        let stdin = child
            .stdin
            .take()
            .ok_or_else(|| "engine_start_failed".to_string())?;
        let stdout = child
            .stdout
            .take()
            .ok_or_else(|| "engine_start_failed".to_string())?;
        let (sender, lines) = mpsc::channel();
        thread::spawn(move || {
            for line in BufReader::new(stdout).lines() {
                match line {
                    Ok(line) => {
                        if sender.send(line).is_err() {
                            break;
                        }
                    }
                    Err(_) => break,
                }
            }
        });
        Ok(Self {
            child,
            stdin,
            lines,
        })
    }

    fn send(&mut self, command: &str) -> Result<(), String> {
        writeln!(self.stdin, "{command}").map_err(|_| "engine_exited".to_string())?;
        self.stdin.flush().map_err(|_| "engine_exited".to_string())
    }

    fn next_line(&self, timeout: Duration) -> Result<String, String> {
        match self.lines.recv_timeout(timeout) {
            Ok(line) => Ok(line),
            Err(RecvTimeoutError::Timeout) => Err("engine_timeout".to_string()),
            Err(RecvTimeoutError::Disconnected) => Err("engine_exited".to_string()),
        }
    }

    fn handshake(&mut self) -> Result<(String, String), String> {
        self.send("uci")?;
        let deadline = Instant::now() + HANDSHAKE_TIMEOUT;
        let mut name = None;
        loop {
            let remaining = deadline
                .checked_duration_since(Instant::now())
                .ok_or_else(|| "engine_not_uci".to_string())?;
            let line = self.next_line(remaining).map_err(|error| {
                if error == "engine_timeout" {
                    "engine_not_uci".to_string()
                } else {
                    error
                }
            })?;
            if let Some(value) = line.strip_prefix("id name ") {
                name = Some(value.trim().to_string());
            }
            if line.trim() == "uciok" {
                break;
            }
        }

        self.send("isready")?;
        let deadline = Instant::now() + HANDSHAKE_TIMEOUT;
        loop {
            let remaining = deadline
                .checked_duration_since(Instant::now())
                .ok_or_else(|| "engine_not_uci".to_string())?;
            let line = self.next_line(remaining).map_err(|error| {
                if error == "engine_timeout" {
                    "engine_not_uci".to_string()
                } else {
                    error
                }
            })?;
            if line.trim() == "readyok" {
                break;
            }
        }

        let name = name
            .filter(|value| !value.is_empty())
            .ok_or_else(|| "engine_malformed".to_string())?;
        let version = engine_version(&name);
        Ok((name, version))
    }

    fn configure(&mut self) -> Result<(), String> {
        self.send("setoption name Threads value 2")?;
        self.send("setoption name Hash value 128")?;
        self.send("setoption name MultiPV value 1")?;
        self.send("isready")?;
        let deadline = Instant::now() + HANDSHAKE_TIMEOUT;
        loop {
            let remaining = deadline
                .checked_duration_since(Instant::now())
                .ok_or_else(|| "engine_timeout".to_string())?;
            if self.next_line(remaining)?.trim() == "readyok" {
                return Ok(());
            }
        }
    }

    fn analyze_position(
        &mut self,
        fen: &str,
        position_index: usize,
        depth: u32,
        cancelled: &AtomicBool,
    ) -> Result<Option<PositionEvaluation>, String> {
        let white_multiplier = white_perspective_multiplier(fen)?;
        self.send(&format!("position fen {fen}"))?;
        self.send(&format!("go depth {depth}"))?;
        let deadline = Instant::now() + POSITION_TIMEOUT;
        let mut latest = None;

        loop {
            if cancelled.load(Ordering::SeqCst) {
                let _ = self.send("stop");
                return Ok(None);
            }
            let remaining = deadline
                .checked_duration_since(Instant::now())
                .ok_or_else(|| "engine_timeout".to_string())?;
            let wait = remaining.min(Duration::from_millis(100));
            let line = match self.lines.recv_timeout(wait) {
                Ok(line) => line,
                Err(RecvTimeoutError::Timeout) => continue,
                Err(RecvTimeoutError::Disconnected) => return Err("engine_exited".to_string()),
            };
            if let Some(info) = parse_info_line(&line) {
                if info.score_cp.is_some() || info.mate.is_some() {
                    latest = Some(info);
                }
            }
            if let Some(best_move) = line.strip_prefix("bestmove ") {
                let best_move = best_move.split_whitespace().next().unwrap_or_default();
                let info = latest.ok_or_else(|| "engine_malformed".to_string())?;
                return Ok(Some(finish_evaluation(
                    position_index,
                    white_multiplier,
                    info,
                    best_move,
                )?));
            }
        }
    }

    fn shutdown(&mut self) {
        let _ = self.send("quit");
        let _ = self.child.wait();
    }
}

impl Drop for UciSession {
    fn drop(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

fn canonical_engine_path(path: &str) -> Result<PathBuf, String> {
    let path = fs::canonicalize(path).map_err(|_| "engine_not_found".to_string())?;
    if !path.is_file() {
        return Err("engine_not_found".to_string());
    }
    #[cfg(windows)]
    if !path
        .extension()
        .and_then(|extension| extension.to_str())
        .is_some_and(|extension| extension.eq_ignore_ascii_case("exe"))
    {
        return Err("engine_not_executable".to_string());
    }
    Ok(path)
}

fn validate_path(path: &str) -> Result<EngineInfo, String> {
    let path = canonical_engine_path(path)?;
    let mut session = UciSession::spawn(&path)?;
    let (name, version) = session.handshake()?;
    session.shutdown();
    Ok(EngineInfo {
        path: path.to_string_lossy().to_string(),
        name,
        version,
    })
}

fn engine_version(name: &str) -> String {
    name.split_whitespace()
        .rev()
        .find(|part| part.chars().any(|character| character.is_ascii_digit()))
        .unwrap_or("unknown")
        .to_string()
}

fn parse_info_line(line: &str) -> Option<ParsedInfo> {
    if !line.starts_with("info ") {
        return None;
    }
    let tokens: Vec<&str> = line.split_whitespace().collect();
    let mut parsed = ParsedInfo::default();
    let mut index = 1;
    while index < tokens.len() {
        match tokens[index] {
            "depth" if index + 1 < tokens.len() => {
                parsed.depth = tokens[index + 1].parse().ok()?;
                index += 2;
            }
            "score" if index + 2 < tokens.len() => {
                let value = tokens[index + 2].parse().ok()?;
                match tokens[index + 1] {
                    "cp" => parsed.score_cp = Some(value),
                    "mate" => parsed.mate = Some(value),
                    _ => return None,
                }
                index += 3;
            }
            "pv" => {
                parsed.pv = tokens[index + 1..]
                    .iter()
                    .map(|move_| (*move_).to_string())
                    .collect();
                break;
            }
            _ => index += 1,
        }
    }
    Some(parsed)
}

fn white_perspective_multiplier(fen: &str) -> Result<i32, String> {
    match fen.split_whitespace().nth(1) {
        Some("w") => Ok(1),
        Some("b") => Ok(-1),
        _ => Err("engine_malformed_position".to_string()),
    }
}

fn finish_evaluation(
    position_index: usize,
    white_multiplier: i32,
    info: ParsedInfo,
    best_move: &str,
) -> Result<PositionEvaluation, String> {
    if best_move.is_empty() {
        return Err("engine_malformed".to_string());
    }
    let terminal = best_move == "(none)";
    Ok(PositionEvaluation {
        position_index,
        score_cp: info.score_cp.map(|score| score * white_multiplier),
        mate: info.mate.map(|mate| mate * white_multiplier),
        depth: info.depth,
        best_move: (!terminal).then(|| best_move.to_string()),
        pv: if terminal { Vec::new() } else { info.pv },
    })
}

fn en_croissant_candidates() -> Vec<PathBuf> {
    let Some(app_data) = std::env::var_os("APPDATA") else {
        return Vec::new();
    };
    let directory = PathBuf::from(app_data)
        .join("org.encroissant.app")
        .join("engines")
        .join("stockfish");
    let mut candidates = Vec::new();
    if let Ok(entries) = fs::read_dir(directory) {
        for entry in entries.flatten() {
            let path = entry.path();
            let is_stockfish =
                path.file_name()
                    .and_then(|name| name.to_str())
                    .is_some_and(|name| {
                        name.to_ascii_lowercase().starts_with("stockfish")
                            && name.to_ascii_lowercase().ends_with(".exe")
                    });
            if is_stockfish {
                candidates.push(path);
            }
        }
    }
    candidates.sort();
    candidates
}

#[tauri::command]
pub fn detect_stockfish() -> Result<Option<EngineInfo>, String> {
    for candidate in en_croissant_candidates() {
        if let Some(path) = candidate.to_str() {
            if let Ok(engine) = validate_path(path) {
                return Ok(Some(engine));
            }
        }
    }
    Ok(None)
}

#[tauri::command]
pub fn validate_engine(path: String) -> Result<EngineInfo, String> {
    validate_path(&path)
}

#[tauri::command]
pub fn cancel_analysis(analysis_id: String, state: State<'_, EngineState>) -> bool {
    let cancellations = state
        .cancellations
        .lock()
        .expect("cancellation lock poisoned");
    if let Some(cancelled) = cancellations.get(&analysis_id) {
        cancelled.store(true, Ordering::SeqCst);
        true
    } else {
        false
    }
}

#[tauri::command]
pub async fn analyze_game(
    request: AnalyzeRequest,
    app: tauri::AppHandle,
    state: State<'_, EngineState>,
) -> Result<AnalyzeResponse, String> {
    if request.depth == 0 || request.depth > 50 {
        return Err("engine_invalid_depth".to_string());
    }
    if request
        .position_indexes
        .iter()
        .any(|index| *index >= request.positions.len())
    {
        return Err("engine_malformed_position".to_string());
    }

    let cancellation = Arc::new(AtomicBool::new(false));
    {
        let mut cancellations = state
            .cancellations
            .lock()
            .expect("cancellation lock poisoned");
        if cancellations.contains_key(&request.analysis_id) {
            return Err("analysis_already_running".to_string());
        }
        cancellations.insert(request.analysis_id.clone(), cancellation.clone());
    }

    let cancellations = state.cancellations.clone();
    let analysis_id = request.analysis_id.clone();
    let result = tauri::async_runtime::spawn_blocking(move || {
        let path = canonical_engine_path(&request.engine_path)?;
        let mut session = UciSession::spawn(&path)?;
        session.handshake()?;
        session.configure()?;
        let total = request.position_indexes.len();
        let mut evaluations = Vec::new();

        for (offset, position_index) in request.position_indexes.iter().copied().enumerate() {
            if cancellation.load(Ordering::SeqCst) {
                break;
            }
            match session.analyze_position(
                &request.positions[position_index],
                position_index,
                request.depth,
                &cancellation,
            )? {
                Some(evaluation) => {
                    app.emit(
                        "analysis-progress",
                        AnalysisProgress {
                            analysis_id: request.analysis_id.clone(),
                            current: offset + 1,
                            total,
                            evaluation: evaluation.clone(),
                        },
                    )
                    .map_err(|_| "analysis_event_failed".to_string())?;
                    evaluations.push(evaluation);
                }
                None => break,
            }
        }
        let cancelled = cancellation.load(Ordering::SeqCst);
        session.shutdown();
        Ok(AnalyzeResponse {
            evaluations,
            cancelled,
        })
    })
    .await
    .map_err(|_| "analysis_task_failed".to_string())?;

    cancellations
        .lock()
        .expect("cancellation lock poisoned")
        .remove(&analysis_id);
    result
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_deterministic_fake_uci_centipawn_transcript() {
        let info = parse_info_line("info depth 18 seldepth 24 score cp 35 nodes 100 pv e2e4 e7e5")
            .unwrap();
        assert_eq!(
            info,
            ParsedInfo {
                depth: 18,
                score_cp: Some(35),
                mate: None,
                pv: vec!["e2e4".to_string(), "e7e5".to_string()],
            }
        );
    }

    #[test]
    fn parses_mate_score_and_ignores_non_info_lines() {
        let info = parse_info_line("info depth 22 score mate -3 pv h7h8q").unwrap();
        assert_eq!(info.mate, Some(-3));
        assert!(parse_info_line("bestmove h7h8q").is_none());
    }

    #[test]
    fn normalizes_engine_scores_to_white_perspective() {
        assert_eq!(
            white_perspective_multiplier("8/8/8/8/8/8/8/8 w - - 0 1"),
            Ok(1)
        );
        assert_eq!(
            white_perspective_multiplier("8/8/8/8/8/8/8/8 b - - 0 1"),
            Ok(-1)
        );
    }

    #[test]
    fn extracts_engine_version_from_fake_handshake_identity() {
        assert_eq!(engine_version("Stockfish 18"), "18");
        assert_eq!(engine_version("Custom Engine"), "unknown");
    }

    #[test]
    fn rejects_malformed_fen_side_to_move() {
        assert_eq!(
            white_perspective_multiplier("not-a-fen"),
            Err("engine_malformed_position".to_string())
        );
    }

    #[test]
    fn accepts_fake_terminal_position_without_best_move_or_pv() {
        let evaluation = finish_evaluation(
            42,
            -1,
            ParsedInfo {
                depth: 0,
                score_cp: None,
                mate: Some(0),
                pv: Vec::new(),
            },
            "(none)",
        )
        .unwrap();
        assert_eq!(evaluation.position_index, 42);
        assert_eq!(evaluation.mate, Some(0));
        assert_eq!(evaluation.best_move, None);
        assert!(evaluation.pv.is_empty());
    }

    #[test]
    #[ignore = "requires CHESSMATE_STOCKFISH to point to a local engine"]
    fn real_stockfish_smoke_analyzes_a_position() {
        let path = std::env::var("CHESSMATE_STOCKFISH").expect("CHESSMATE_STOCKFISH is required");
        let info = validate_path(&path).expect("local engine must pass the UCI handshake");
        assert!(!info.name.is_empty());

        let canonical = canonical_engine_path(&path).unwrap();
        let mut session = UciSession::spawn(&canonical).unwrap();
        session.handshake().unwrap();
        session.configure().unwrap();
        let evaluation = session
            .analyze_position(
                "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1",
                0,
                8,
                &AtomicBool::new(false),
            )
            .unwrap()
            .expect("analysis should complete");
        assert_eq!(evaluation.position_index, 0);
        assert!(evaluation.depth >= 8);
        assert!(evaluation.best_move.is_some());
        assert!(!evaluation.pv.is_empty());

        let terminal = session
            .analyze_position(
                "7k/6Q1/6K1/8/8/8/8/8 b - - 0 1",
                1,
                8,
                &AtomicBool::new(false),
            )
            .unwrap()
            .expect("terminal analysis should complete");
        assert_eq!(terminal.mate, Some(0));
        assert_eq!(terminal.best_move, None);
        assert!(terminal.pv.is_empty());
        session.shutdown();
    }
}
