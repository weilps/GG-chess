use std::{fs, path::PathBuf};

mod chess_com;
mod codex;
mod engine;

const MAX_PGN_BYTES: u64 = 50 * 1024 * 1024;

fn has_pgn_extension(path: &std::path::Path) -> bool {
    path.extension()
        .and_then(|extension| extension.to_str())
        .is_some_and(|extension| extension.eq_ignore_ascii_case("pgn"))
}

#[tauri::command]
fn read_pgn_file(path: String) -> Result<String, String> {
    let requested_path = PathBuf::from(path);
    if !has_pgn_extension(&requested_path) {
        return Err("Only PGN files can be imported".into());
    }

    let canonical_path = fs::canonicalize(&requested_path).map_err(|error| error.to_string())?;
    if !has_pgn_extension(&canonical_path) {
        return Err("The selected file does not resolve to a PGN file".into());
    }

    let metadata = fs::metadata(&canonical_path).map_err(|error| error.to_string())?;
    if !metadata.is_file() {
        return Err("The selected path is not a file".into());
    }
    if metadata.len() > MAX_PGN_BYTES {
        return Err("The selected PGN exceeds the 50 MB import limit".into());
    }

    fs::read_to_string(canonical_path).map_err(|error| error.to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(codex::CodexState::default())
        .manage(engine::EngineState::default())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_sql::Builder::default().build())
        .invoke_handler(tauri::generate_handler![
            read_pgn_file,
            engine::detect_stockfish,
            engine::validate_engine,
            engine::analyze_game,
            engine::cancel_analysis,
            codex::request_codex_advice,
            chess_com::chess_com_fetch_archives,
            chess_com::chess_com_fetch_month
        ])
        .run(tauri::generate_context!())
        .expect("error while running ChessMate");
}
