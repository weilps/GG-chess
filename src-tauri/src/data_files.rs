use atomic_write_file::AtomicWriteFile;
use rusqlite::{params, Connection, OptionalExtension, Transaction, TransactionBehavior};
use serde::{Deserialize, Serialize};
use std::{
    collections::{HashMap, HashSet},
    fs,
    io::Write,
    path::{Path, PathBuf},
    time::Duration,
};
use tauri::Manager;

const BACKUP_SCHEMA_VERSION: u32 = 2;
const MAX_PORTABLE_BYTES: usize = 50 * 1024 * 1024;
const PORTABLE_SETTINGS: [&str; 7] = [
    "analysisProfile",
    "analysisMultiPv",
    "guidanceEnabled",
    "guidanceMode",
    "chessComUsername",
    "trainingPlayerNames",
    "trainingCoachProfile",
];

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PortableBackup {
    schema_version: u32,
    created_at: String,
    app_version: String,
    language: String,
    games: Vec<BackupGame>,
    analysis_caches: Vec<BackupCache>,
    chess_com_sync_states: Vec<BackupSyncState>,
    puzzle_progress: Vec<BackupPuzzleProgress>,
    training_activities: Vec<BackupTrainingActivity>,
    training_days: Vec<String>,
    settings: HashMap<String, String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct BackupGame {
    fingerprint: String,
    white: String,
    black: String,
    result: String,
    played_at: Option<String>,
    display_date: Option<String>,
    time_control: Option<String>,
    source: Option<String>,
    raw_pgn: String,
    moves: Vec<String>,
    positions: Vec<String>,
    imported_at: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct BackupCache {
    game_fingerprint: String,
    engine_name: String,
    engine_version: String,
    profile: String,
    multi_pv: u8,
    analyzed_at: String,
    evaluations: Vec<BackupEvaluation>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct BackupEvaluation {
    game_fingerprint: String,
    engine_name: String,
    engine_version: String,
    profile: String,
    multi_pv: u8,
    position_index: i64,
    score_cp: Option<i64>,
    mate: Option<i64>,
    depth: i64,
    best_move: Option<String>,
    pv: Vec<String>,
    variations: Vec<BackupVariation>,
    analyzed_at: String,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct BackupVariation {
    rank: u8,
    score_cp: Option<i64>,
    mate: Option<i64>,
    depth: i64,
    best_move: Option<String>,
    pv: Vec<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct BackupSyncState {
    username: String,
    year_month: String,
    etag: Option<String>,
    last_modified: Option<String>,
    completed_at: Option<String>,
    checked_at: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct BackupPuzzleProgress {
    puzzle_key: String,
    attempts: i64,
    successes: i64,
    last_result: String,
    due_at: String,
    updated_at: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct BackupTrainingActivity {
    week_start: String,
    kind: String,
    item_key: String,
    occurred_on: String,
    created_at: String,
}

#[derive(Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RestoreSummary {
    added: u64,
    updated: u64,
    unchanged: u64,
    rejected: u64,
}

#[tauri::command]
pub(crate) fn read_backup_file(path: String) -> Result<String, String> {
    read_bounded_file(&path, "json")
}

#[tauri::command]
pub(crate) fn write_backup_file(path: String, contents: String) -> Result<(), String> {
    write_bounded_file(&path, &contents, "json")
}

#[tauri::command]
pub(crate) fn write_pgn_export(path: String, contents: String) -> Result<(), String> {
    write_bounded_file(&path, &contents, "pgn")
}

#[tauri::command]
pub(crate) fn restore_portable_backup(
    app: tauri::AppHandle,
    backup: PortableBackup,
) -> Result<RestoreSummary, String> {
    validate_backup(&backup)?;
    let data_dir = app
        .path()
        .app_data_dir()
        .map_err(|error| error.to_string())?;
    fs::create_dir_all(&data_dir).map_err(|error| error.to_string())?;
    let database_path = data_dir.join("chessmate.db");
    let mut connection = Connection::open(database_path).map_err(|error| error.to_string())?;
    connection
        .busy_timeout(Duration::from_secs(10))
        .map_err(|error| error.to_string())?;
    restore_into_connection(&mut connection, &backup)
}

fn read_bounded_file(path: &str, extension: &str) -> Result<String, String> {
    let requested = PathBuf::from(path);
    validate_selected_path(&requested, extension, true)?;
    let canonical = fs::canonicalize(&requested).map_err(|error| error.to_string())?;
    validate_selected_path(&canonical, extension, true)?;
    let metadata = fs::metadata(&canonical).map_err(|error| error.to_string())?;
    if metadata.len() as usize > MAX_PORTABLE_BYTES {
        return Err("The selected file exceeds the 50 MB limit".into());
    }
    fs::read_to_string(canonical).map_err(|error| error.to_string())
}

fn write_bounded_file(path: &str, contents: &str, extension: &str) -> Result<(), String> {
    if contents.len() > MAX_PORTABLE_BYTES {
        return Err("The export exceeds the 50 MB limit".into());
    }
    let requested = PathBuf::from(path);
    validate_selected_path(&requested, extension, false)?;
    let parent = requested
        .parent()
        .ok_or_else(|| "The selected path has no parent directory".to_string())?;
    let canonical_parent = fs::canonicalize(parent).map_err(|error| error.to_string())?;
    if !canonical_parent.is_dir() {
        return Err("The selected parent is not a directory".into());
    }
    let file_name = requested
        .file_name()
        .ok_or_else(|| "The selected path has no file name".to_string())?;
    let target = canonical_parent.join(file_name);
    validate_selected_path(&target, extension, false)?;
    let mut file = AtomicWriteFile::open(&target).map_err(|error| error.to_string())?;
    file.write_all(contents.as_bytes())
        .map_err(|error| error.to_string())?;
    file.commit().map_err(|error| error.to_string())
}

fn validate_selected_path(path: &Path, extension: &str, must_exist: bool) -> Result<(), String> {
    if !path.is_absolute() {
        return Err("Only absolute paths selected by the file dialog are accepted".into());
    }
    let valid_extension = path
        .extension()
        .and_then(|value| value.to_str())
        .is_some_and(|value| value.eq_ignore_ascii_case(extension));
    if !valid_extension {
        return Err(format!("Only .{extension} files are accepted"));
    }
    if must_exist && !path.is_file() {
        return Err("The selected path is not a file".into());
    }
    Ok(())
}

fn validate_backup(backup: &PortableBackup) -> Result<(), String> {
    if backup.schema_version != BACKUP_SCHEMA_VERSION {
        return Err("Unsupported backup schema".into());
    }
    if backup.created_at.is_empty()
        || backup.app_version.is_empty()
        || !matches!(backup.language.as_str(), "en" | "fr")
        || backup.games.len() > 100_000
        || backup.analysis_caches.len() > 500_000
        || backup.chess_com_sync_states.len() > 10_000
        || backup.puzzle_progress.len() > 1_000_000
        || backup.training_activities.len() > 1_000_000
        || backup.training_days.len() > 100_000
    {
        return Err("Invalid backup metadata or limits".into());
    }
    let mut position_counts = HashMap::new();
    for game in &backup.games {
        if game.fingerprint.is_empty()
            || game.positions.len() != game.moves.len() + 1
            || position_counts
                .insert(game.fingerprint.as_str(), game.positions.len())
                .is_some()
        {
            return Err("Invalid or duplicate game".into());
        }
    }
    for cache in &backup.analysis_caches {
        let Some(position_count) = position_counts.get(cache.game_fingerprint.as_str()) else {
            return Err("Analysis cache does not match a backed-up game".into());
        };
        if !matches!(cache.profile.as_str(), "quick" | "balanced" | "deep")
            || !(1..=3).contains(&cache.multi_pv)
            || cache.analyzed_at.is_empty()
        {
            return Err("Analysis cache does not match a backed-up game".into());
        }
        for evaluation in &cache.evaluations {
            if evaluation.game_fingerprint != cache.game_fingerprint
                || evaluation.engine_name != cache.engine_name
                || evaluation.engine_version != cache.engine_version
                || evaluation.profile != cache.profile
                || evaluation.multi_pv != cache.multi_pv
                || evaluation.position_index < 0
                || evaluation.position_index as usize >= *position_count
                || evaluation.depth < 0
                || evaluation.variations.is_empty()
                || evaluation.variations.len() > cache.multi_pv as usize
                || evaluation
                    .variations
                    .iter()
                    .enumerate()
                    .any(|(index, variation)| {
                        variation.rank as usize != index + 1 || variation.depth < 0
                    })
                || evaluation.variations.first().is_some_and(|rank_one| {
                    evaluation.score_cp != rank_one.score_cp
                        || evaluation.mate != rank_one.mate
                        || evaluation.depth != rank_one.depth
                        || evaluation.best_move != rank_one.best_move
                        || evaluation.pv != rank_one.pv
                })
            {
                return Err("Invalid analysis evaluation".into());
            }
        }
    }
    let days: HashSet<&str> = backup.training_days.iter().map(String::as_str).collect();
    if backup
        .training_activities
        .iter()
        .any(|activity| !days.contains(activity.occurred_on.as_str()))
    {
        return Err("Training activity day is missing".into());
    }
    if backup
        .settings
        .keys()
        .any(|key| !PORTABLE_SETTINGS.contains(&key.as_str()))
    {
        return Err("Backup contains a non-portable setting".into());
    }
    Ok(())
}

fn restore_into_connection(
    connection: &mut Connection,
    backup: &PortableBackup,
) -> Result<RestoreSummary, String> {
    let transaction = connection
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(|error| error.to_string())?;
    let mut summary = RestoreSummary::default();
    restore_games(&transaction, backup, &mut summary).map_err(|error| error.to_string())?;
    restore_evaluations(&transaction, backup, &mut summary).map_err(|error| error.to_string())?;
    restore_sync_states(&transaction, backup, &mut summary).map_err(|error| error.to_string())?;
    restore_puzzle_progress(&transaction, backup, &mut summary)
        .map_err(|error| error.to_string())?;
    restore_training(&transaction, backup, &mut summary).map_err(|error| error.to_string())?;
    restore_settings(&transaction, backup, &mut summary).map_err(|error| error.to_string())?;
    transaction.commit().map_err(|error| error.to_string())?;
    Ok(summary)
}

fn restore_games(
    transaction: &Transaction<'_>,
    backup: &PortableBackup,
    summary: &mut RestoreSummary,
) -> rusqlite::Result<()> {
    for game in &backup.games {
        let existing: Option<String> = transaction
            .query_row(
                "SELECT imported_at FROM games WHERE fingerprint = ?1",
                [&game.fingerprint],
                |row| row.get(0),
            )
            .optional()?;
        match existing {
            None => {
                transaction.execute(
                    "INSERT INTO games (fingerprint, white_player, black_player, result, played_at, display_date, time_control, source, raw_pgn, moves_json, positions_json, imported_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)",
                    params![game.fingerprint, game.white, game.black, game.result, game.played_at, game.display_date, game.time_control, game.source, game.raw_pgn, serde_json::to_string(&game.moves).unwrap_or_default(), serde_json::to_string(&game.positions).unwrap_or_default(), game.imported_at],
                )?;
                summary.added += 1;
            }
            Some(timestamp) if game.imported_at > timestamp => {
                transaction.execute(
                    "UPDATE games SET white_player=?2, black_player=?3, result=?4, played_at=?5, display_date=?6, time_control=?7, source=?8, raw_pgn=?9, moves_json=?10, positions_json=?11, imported_at=?12 WHERE fingerprint=?1",
                    params![game.fingerprint, game.white, game.black, game.result, game.played_at, game.display_date, game.time_control, game.source, game.raw_pgn, serde_json::to_string(&game.moves).unwrap_or_default(), serde_json::to_string(&game.positions).unwrap_or_default(), game.imported_at],
                )?;
                summary.updated += 1;
            }
            Some(_) => summary.unchanged += 1,
        }
    }
    Ok(())
}

fn restore_evaluations(
    transaction: &Transaction<'_>,
    backup: &PortableBackup,
    summary: &mut RestoreSummary,
) -> rusqlite::Result<()> {
    for cache in &backup.analysis_caches {
        for evaluation in &cache.evaluations {
            let existing: Option<String> = transaction
            .query_row(
                "SELECT analyzed_at FROM position_evaluations_v2 WHERE game_fingerprint=?1 AND engine_name=?2 AND engine_version=?3 AND profile=?4 AND multi_pv=?5 AND position_index=?6",
                params![evaluation.game_fingerprint, evaluation.engine_name, evaluation.engine_version, evaluation.profile, cache.multi_pv, evaluation.position_index],
                |row| row.get(0),
            )
            .optional()?;
            if existing
                .as_ref()
                .is_some_and(|timestamp| timestamp >= &evaluation.analyzed_at)
            {
                summary.unchanged += 1;
                continue;
            }
            transaction.execute(
            "INSERT INTO position_evaluations_v2 (game_fingerprint, engine_name, engine_version, profile, multi_pv, position_index, score_cp, mate, depth, best_move, pv_json, variations_json, analyzed_at) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13) ON CONFLICT(game_fingerprint,engine_name,engine_version,profile,multi_pv,position_index) DO UPDATE SET score_cp=excluded.score_cp,mate=excluded.mate,depth=excluded.depth,best_move=excluded.best_move,pv_json=excluded.pv_json,variations_json=excluded.variations_json,analyzed_at=excluded.analyzed_at",
            params![evaluation.game_fingerprint, evaluation.engine_name, evaluation.engine_version, evaluation.profile, cache.multi_pv, evaluation.position_index, evaluation.score_cp, evaluation.mate, evaluation.depth, evaluation.best_move.as_deref().unwrap_or(""), serde_json::to_string(&evaluation.pv).unwrap_or_default(), serde_json::to_string(&evaluation.variations).unwrap_or_default(), evaluation.analyzed_at],
        )?;
            if existing.is_some() {
                summary.updated += 1;
            } else {
                summary.added += 1;
            }
        }
    }
    Ok(())
}

fn restore_sync_states(
    transaction: &Transaction<'_>,
    backup: &PortableBackup,
    summary: &mut RestoreSummary,
) -> rusqlite::Result<()> {
    for state in &backup.chess_com_sync_states {
        let existing: Option<String> = transaction
            .query_row(
                "SELECT checked_at FROM chess_com_sync_months WHERE username=?1 AND year_month=?2",
                params![state.username, state.year_month],
                |row| row.get(0),
            )
            .optional()?;
        if existing
            .as_ref()
            .is_some_and(|timestamp| timestamp >= &state.checked_at)
        {
            summary.unchanged += 1;
            continue;
        }
        transaction.execute(
            "INSERT INTO chess_com_sync_months (username,year_month,etag,last_modified,completed_at,checked_at) VALUES (?1,?2,?3,?4,?5,?6) ON CONFLICT(username,year_month) DO UPDATE SET etag=excluded.etag,last_modified=excluded.last_modified,completed_at=excluded.completed_at,checked_at=excluded.checked_at",
            params![state.username, state.year_month, state.etag, state.last_modified, state.completed_at, state.checked_at],
        )?;
        if existing.is_some() {
            summary.updated += 1
        } else {
            summary.added += 1
        }
    }
    Ok(())
}

fn restore_puzzle_progress(
    transaction: &Transaction<'_>,
    backup: &PortableBackup,
    summary: &mut RestoreSummary,
) -> rusqlite::Result<()> {
    for item in &backup.puzzle_progress {
        let existing: Option<String> = transaction
            .query_row(
                "SELECT updated_at FROM training_puzzle_progress WHERE puzzle_key=?1",
                [&item.puzzle_key],
                |row| row.get(0),
            )
            .optional()?;
        if existing
            .as_ref()
            .is_some_and(|timestamp| timestamp >= &item.updated_at)
        {
            summary.unchanged += 1;
            continue;
        }
        transaction.execute(
            "INSERT INTO training_puzzle_progress (puzzle_key,attempts,successes,last_result,due_at,updated_at) VALUES (?1,?2,?3,?4,?5,?6) ON CONFLICT(puzzle_key) DO UPDATE SET attempts=excluded.attempts,successes=excluded.successes,last_result=excluded.last_result,due_at=excluded.due_at,updated_at=excluded.updated_at",
            params![item.puzzle_key, item.attempts, item.successes, item.last_result, item.due_at, item.updated_at],
        )?;
        if existing.is_some() {
            summary.updated += 1
        } else {
            summary.added += 1
        }
    }
    Ok(())
}

fn restore_training(
    transaction: &Transaction<'_>,
    backup: &PortableBackup,
    summary: &mut RestoreSummary,
) -> rusqlite::Result<()> {
    for activity in &backup.training_activities {
        let changed = transaction.execute(
            "INSERT OR IGNORE INTO training_activities (week_start,kind,item_key,occurred_on,created_at) VALUES (?1,?2,?3,?4,?5)",
            params![activity.week_start, activity.kind, activity.item_key, activity.occurred_on, activity.created_at],
        )?;
        if changed > 0 {
            summary.added += 1
        } else {
            summary.unchanged += 1
        }
    }
    for day in &backup.training_days {
        let changed = transaction.execute(
            "INSERT OR IGNORE INTO training_days (day) VALUES (?1)",
            [day],
        )?;
        if changed > 0 {
            summary.added += 1
        } else {
            summary.unchanged += 1
        }
    }
    Ok(())
}

fn restore_settings(
    transaction: &Transaction<'_>,
    backup: &PortableBackup,
    summary: &mut RestoreSummary,
) -> rusqlite::Result<()> {
    for (key, value) in &backup.settings {
        let existing: Option<String> = transaction
            .query_row(
                "SELECT value FROM app_settings WHERE key=?1",
                [key],
                |row| row.get(0),
            )
            .optional()?;
        match existing {
            None => {
                transaction.execute(
                    "INSERT INTO app_settings (key,value) VALUES (?1,?2)",
                    params![key, value],
                )?;
                summary.added += 1;
            }
            Some(current) if current != *value => {
                transaction.execute(
                    "UPDATE app_settings SET value=?2 WHERE key=?1",
                    params![key, value],
                )?;
                summary.updated += 1;
            }
            Some(_) => summary.unchanged += 1,
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_non_portable_settings_before_opening_the_database() {
        let mut backup = empty_backup();
        backup
            .settings
            .insert("enginePath".into(), "secret-path".into());
        assert_eq!(
            validate_backup(&backup).unwrap_err(),
            "Backup contains a non-portable setting"
        );
    }

    #[test]
    fn rejects_out_of_range_evaluations_before_any_restore() {
        let mut backup = empty_backup();
        backup.games.push(sample_game());
        backup.analysis_caches.push(BackupCache {
            game_fingerprint: "game".into(),
            engine_name: "Stockfish".into(),
            engine_version: "18".into(),
            profile: "balanced".into(),
            multi_pv: 1,
            analyzed_at: "2026-08-25T00:00:00Z".into(),
            evaluations: vec![BackupEvaluation {
                game_fingerprint: "game".into(),
                engine_name: "Stockfish".into(),
                engine_version: "18".into(),
                profile: "balanced".into(),
                multi_pv: 1,
                position_index: 500,
                score_cp: Some(10),
                mate: None,
                depth: 18,
                best_move: Some("e2e4".into()),
                pv: vec!["e2e4".into()],
                variations: vec![BackupVariation {
                    rank: 1,
                    score_cp: Some(10),
                    mate: None,
                    depth: 18,
                    best_move: Some("e2e4".into()),
                    pv: vec!["e2e4".into()],
                }],
                analyzed_at: "2026-08-25T00:00:00Z".into(),
            }],
        });

        assert_eq!(
            validate_backup(&backup).unwrap_err(),
            "Invalid analysis evaluation"
        );
    }

    #[test]
    fn rolls_back_all_rows_when_a_later_table_is_missing() {
        let mut connection = Connection::open_in_memory().unwrap();
        connection.execute_batch(
            "CREATE TABLE games (fingerprint TEXT PRIMARY KEY, white_player TEXT, black_player TEXT, result TEXT, played_at TEXT, display_date TEXT, time_control TEXT, source TEXT, raw_pgn TEXT, moves_json TEXT, positions_json TEXT, imported_at TEXT);",
        ).unwrap();
        let mut backup = empty_backup();
        backup.games.push(sample_game());
        backup
            .settings
            .insert("analysisProfile".into(), "balanced".into());
        assert!(restore_into_connection(&mut connection, &backup).is_err());
        let count: i64 = connection
            .query_row("SELECT COUNT(*) FROM games", [], |row| row.get(0))
            .unwrap();
        assert_eq!(count, 0);
    }

    #[test]
    fn restores_separate_multipv_caches_and_every_ranked_variation() {
        let mut connection = Connection::open_in_memory().unwrap();
        connection.execute_batch(
            "CREATE TABLE games (fingerprint TEXT PRIMARY KEY, white_player TEXT, black_player TEXT, result TEXT, played_at TEXT, display_date TEXT, time_control TEXT, source TEXT, raw_pgn TEXT, moves_json TEXT, positions_json TEXT, imported_at TEXT);
             CREATE TABLE position_evaluations_v2 (game_fingerprint TEXT, engine_name TEXT, engine_version TEXT, profile TEXT, multi_pv INTEGER, position_index INTEGER, score_cp INTEGER, mate INTEGER, depth INTEGER, best_move TEXT, pv_json TEXT, variations_json TEXT, analyzed_at TEXT, PRIMARY KEY(game_fingerprint,engine_name,engine_version,profile,multi_pv,position_index));
             CREATE TABLE chess_com_sync_months (username TEXT, year_month TEXT, etag TEXT, last_modified TEXT, completed_at TEXT, checked_at TEXT, PRIMARY KEY(username,year_month));
             CREATE TABLE training_puzzle_progress (puzzle_key TEXT PRIMARY KEY, attempts INTEGER, successes INTEGER, last_result TEXT, due_at TEXT, updated_at TEXT);
             CREATE TABLE training_activities (week_start TEXT, kind TEXT, item_key TEXT, occurred_on TEXT, created_at TEXT, PRIMARY KEY(week_start,kind,item_key));
             CREATE TABLE training_days (day TEXT PRIMARY KEY);
             CREATE TABLE app_settings (key TEXT PRIMARY KEY, value TEXT);",
        ).unwrap();
        let mut backup = empty_backup();
        backup.games.push(sample_game());
        backup.analysis_caches.push(sample_cache(1));
        backup.analysis_caches.push(sample_cache(3));

        restore_into_connection(&mut connection, &backup).unwrap();
        let cache_count: i64 = connection
            .query_row("SELECT COUNT(*) FROM position_evaluations_v2", [], |row| {
                row.get(0)
            })
            .unwrap();
        let variations_json: String = connection
            .query_row(
                "SELECT variations_json FROM position_evaluations_v2 WHERE multi_pv=3",
                [],
                |row| row.get(0),
            )
            .unwrap();
        let variations: Vec<BackupVariation> = serde_json::from_str(&variations_json).unwrap();
        assert_eq!(cache_count, 2);
        assert_eq!(variations.len(), 3);
        assert_eq!(variations[2].rank, 3);
    }

    fn empty_backup() -> PortableBackup {
        PortableBackup {
            schema_version: BACKUP_SCHEMA_VERSION,
            created_at: "2026-08-25T00:00:00Z".into(),
            app_version: "0.1.0".into(),
            language: "en".into(),
            games: vec![],
            analysis_caches: vec![],
            chess_com_sync_states: vec![],
            puzzle_progress: vec![],
            training_activities: vec![],
            training_days: vec![],
            settings: HashMap::new(),
        }
    }

    fn sample_game() -> BackupGame {
        BackupGame {
            fingerprint: "game".into(),
            white: "Ada".into(),
            black: "Grace".into(),
            result: "1-0".into(),
            played_at: None,
            display_date: None,
            time_control: None,
            source: None,
            raw_pgn: "[Result \"1-0\"]\n\n1. e4 1-0".into(),
            moves: vec!["e4".into()],
            positions: vec!["start".into(), "after".into()],
            imported_at: "2026-08-25T00:00:00Z".into(),
        }
    }

    fn sample_cache(multi_pv: u8) -> BackupCache {
        let variations = (1..=multi_pv)
            .map(|rank| BackupVariation {
                rank,
                score_cp: Some(30 - i64::from(rank) * 5),
                mate: None,
                depth: 18,
                best_move: Some(format!("move{rank}")),
                pv: vec![format!("move{rank}")],
            })
            .collect::<Vec<_>>();
        let score_cp = variations[0].score_cp;
        let mate = variations[0].mate;
        let depth = variations[0].depth;
        let best_move = variations[0].best_move.clone();
        let pv = variations[0].pv.clone();
        BackupCache {
            game_fingerprint: "game".into(),
            engine_name: "Stockfish".into(),
            engine_version: "18".into(),
            profile: "balanced".into(),
            multi_pv,
            analyzed_at: format!("2026-08-25T00:00:0{multi_pv}Z"),
            evaluations: vec![BackupEvaluation {
                game_fingerprint: "game".into(),
                engine_name: "Stockfish".into(),
                engine_version: "18".into(),
                profile: "balanced".into(),
                multi_pv,
                position_index: 0,
                score_cp,
                mate,
                depth,
                best_move,
                pv,
                variations,
                analyzed_at: format!("2026-08-25T00:00:0{multi_pv}Z"),
            }],
        }
    }
}
