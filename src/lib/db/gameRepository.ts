import { isTauri } from "@tauri-apps/api/core";
import Database from "@tauri-apps/plugin-sql";
import type {
  AnalysisProfileId,
  EngineInfo,
  ParsedGame,
  PositionEvaluation,
  StoredGame,
  StoredPositionEvaluation,
} from "../../types";

export interface AddGamesResult {
  added: number;
  duplicates: number;
}

export interface ChessComMonthSyncState {
  username: string;
  yearMonth: string;
  etag: string | null;
  lastModified: string | null;
  completedAt: string | null;
  checkedAt: string;
}

export interface StoredAnalysisCache {
  gameFingerprint: string;
  engineName: string;
  engineVersion: string;
  profile: AnalysisProfileId;
  analyzedAt: string;
  evaluations: StoredPositionEvaluation[];
}

export type PuzzleResult = "incorrect" | "revealed" | "again" | "good" | "easy";

export interface PuzzleProgress {
  puzzleKey: string;
  attempts: number;
  successes: number;
  lastResult: PuzzleResult;
  dueAt: string;
  updatedAt: string;
}

export type TrainingActivityKind = "review" | "puzzle" | "opening";

export interface TrainingActivity {
  weekStart: string;
  kind: TrainingActivityKind;
  itemKey: string;
  occurredOn: string;
  createdAt: string;
}

export interface GameRepository {
  initialize(): Promise<void>;
  listGames(): Promise<StoredGame[]>;
  addGames(games: ParsedGame[]): Promise<AddGamesResult>;
  getSetting(key: string): Promise<string | null>;
  setSetting(key: string, value: string): Promise<void>;
  listChessComSyncStates(username: string): Promise<ChessComMonthSyncState[]>;
  saveChessComSyncState(state: ChessComMonthSyncState): Promise<void>;
  listAnalysisCaches(): Promise<StoredAnalysisCache[]>;
  listPuzzleProgress(): Promise<PuzzleProgress[]>;
  savePuzzleProgress(progress: PuzzleProgress): Promise<void>;
  recordTrainingActivity(activity: TrainingActivity): Promise<void>;
  listTrainingActivities(weekStart: string): Promise<TrainingActivity[]>;
  listTrainingDays(): Promise<string[]>;
  getAnalysis(
    gameFingerprint: string,
    engine: EngineInfo,
    profile: AnalysisProfileId,
  ): Promise<StoredPositionEvaluation[]>;
  saveEvaluations(
    gameFingerprint: string,
    engine: EngineInfo,
    profile: AnalysisProfileId,
    evaluations: PositionEvaluation[],
  ): Promise<void>;
  clearAnalysis(
    gameFingerprint: string,
    engine: EngineInfo,
    profile: AnalysisProfileId,
  ): Promise<void>;
}

export function sortGamesNewestFirst(games: StoredGame[]): StoredGame[] {
  return [...games].sort((left, right) => {
    if (left.playedAt && right.playedAt) {
      const dateDifference = right.playedAt.localeCompare(left.playedAt);
      if (dateDifference !== 0) return dateDifference;
    } else if (left.playedAt) {
      return -1;
    } else if (right.playedAt) {
      return 1;
    }
    return right.importedAt.localeCompare(left.importedAt);
  });
}

export class MemoryGameRepository implements GameRepository {
  private readonly games = new Map<string, StoredGame>();
  private readonly settings = new Map<string, string>();
  private readonly evaluations = new Map<string, StoredPositionEvaluation>();
  private readonly chessComSyncStates = new Map<string, ChessComMonthSyncState>();
  private readonly puzzleProgress = new Map<string, PuzzleProgress>();
  private readonly trainingActivities = new Map<string, TrainingActivity>();
  private readonly trainingDays = new Set<string>();

  async initialize(): Promise<void> {
    return Promise.resolve();
  }

  async listGames(): Promise<StoredGame[]> {
    return sortGamesNewestFirst([...this.games.values()]);
  }

  async addGames(games: ParsedGame[]): Promise<AddGamesResult> {
    let added = 0;
    let duplicates = 0;
    const importedAt = new Date().toISOString();
    for (const game of games) {
      if (this.games.has(game.fingerprint)) {
        duplicates += 1;
      } else {
        this.games.set(game.fingerprint, { ...game, importedAt });
        added += 1;
      }
    }
    return { added, duplicates };
  }

  async getSetting(key: string): Promise<string | null> {
    return this.settings.get(key) ?? null;
  }

  async setSetting(key: string, value: string): Promise<void> {
    this.settings.set(key, value);
  }

  async listChessComSyncStates(username: string): Promise<ChessComMonthSyncState[]> {
    return [...this.chessComSyncStates.values()]
      .filter((state) => state.username === username)
      .sort((left, right) => left.yearMonth.localeCompare(right.yearMonth));
  }

  async saveChessComSyncState(state: ChessComMonthSyncState): Promise<void> {
    this.chessComSyncStates.set(`${state.username}\u0000${state.yearMonth}`, { ...state });
  }

  async listAnalysisCaches(): Promise<StoredAnalysisCache[]> {
    return groupAnalysisCaches([...this.evaluations.values()]);
  }

  async listPuzzleProgress(): Promise<PuzzleProgress[]> {
    return [...this.puzzleProgress.values()];
  }

  async savePuzzleProgress(progress: PuzzleProgress): Promise<void> {
    this.puzzleProgress.set(progress.puzzleKey, { ...progress });
  }

  async recordTrainingActivity(activity: TrainingActivity): Promise<void> {
    const key = `${activity.weekStart}\u0000${activity.kind}\u0000${activity.itemKey}`;
    if (!this.trainingActivities.has(key)) {
      this.trainingActivities.set(key, { ...activity });
    }
    this.trainingDays.add(activity.occurredOn);
  }

  async listTrainingActivities(weekStart: string): Promise<TrainingActivity[]> {
    return [...this.trainingActivities.values()]
      .filter((activity) => activity.weekStart === weekStart);
  }

  async listTrainingDays(): Promise<string[]> {
    return [...this.trainingDays].sort();
  }

  async getAnalysis(
    gameFingerprint: string,
    engine: EngineInfo,
    profile: AnalysisProfileId,
  ): Promise<StoredPositionEvaluation[]> {
    return [...this.evaluations.values()]
      .filter((evaluation) =>
        evaluation.gameFingerprint === gameFingerprint
        && evaluation.engineName === engine.name
        && evaluation.engineVersion === engine.version
        && evaluation.profile === profile)
      .sort((left, right) => left.positionIndex - right.positionIndex);
  }

  async saveEvaluations(
    gameFingerprint: string,
    engine: EngineInfo,
    profile: AnalysisProfileId,
    evaluations: PositionEvaluation[],
  ): Promise<void> {
    const analyzedAt = new Date().toISOString();
    for (const evaluation of evaluations) {
      const key = analysisKey(gameFingerprint, engine, profile, evaluation.positionIndex);
      this.evaluations.set(key, {
        ...evaluation,
        gameFingerprint,
        engineName: engine.name,
        engineVersion: engine.version,
        profile,
        analyzedAt,
      });
    }
  }

  async clearAnalysis(
    gameFingerprint: string,
    engine: EngineInfo,
    profile: AnalysisProfileId,
  ): Promise<void> {
    for (const [key, evaluation] of this.evaluations) {
      if (
        evaluation.gameFingerprint === gameFingerprint
        && evaluation.engineName === engine.name
        && evaluation.engineVersion === engine.version
        && evaluation.profile === profile
      ) {
        this.evaluations.delete(key);
      }
    }
  }
}

function analysisKey(
  gameFingerprint: string,
  engine: EngineInfo,
  profile: AnalysisProfileId,
  positionIndex: number,
): string {
  return [gameFingerprint, engine.name, engine.version, profile, positionIndex].join("\u0000");
}

interface GameRow {
  fingerprint: string;
  white_player: string;
  black_player: string;
  result: string;
  played_at: string | null;
  display_date: string | null;
  time_control: string | null;
  source: string | null;
  raw_pgn: string;
  moves_json: string;
  positions_json: string;
  imported_at: string;
}

interface SettingRow {
  value: string;
}

interface EvaluationRow {
  game_fingerprint: string;
  engine_name: string;
  engine_version: string;
  profile: AnalysisProfileId;
  position_index: number;
  score_cp: number | null;
  mate: number | null;
  depth: number;
  best_move: string;
  pv_json: string;
  analyzed_at: string;
}

interface ChessComSyncRow {
  username: string;
  year_month: string;
  etag: string | null;
  last_modified: string | null;
  completed_at: string | null;
  checked_at: string;
}

interface PuzzleProgressRow {
  puzzle_key: string;
  attempts: number;
  successes: number;
  last_result: PuzzleResult;
  due_at: string;
  updated_at: string;
}

interface TrainingActivityRow {
  week_start: string;
  kind: TrainingActivityKind;
  item_key: string;
  occurred_on: string;
  created_at: string;
}

function evaluationFromRow(row: EvaluationRow): StoredPositionEvaluation {
  return {
    gameFingerprint: row.game_fingerprint,
    engineName: row.engine_name,
    engineVersion: row.engine_version,
    profile: row.profile,
    positionIndex: row.position_index,
    scoreCp: row.score_cp,
    mate: row.mate,
    depth: row.depth,
    bestMove: row.best_move || null,
    pv: JSON.parse(row.pv_json) as string[],
    analyzedAt: row.analyzed_at,
  };
}

function groupAnalysisCaches(
  evaluations: StoredPositionEvaluation[],
): StoredAnalysisCache[] {
  const groups = new Map<string, StoredAnalysisCache>();
  for (const evaluation of evaluations) {
    const key = [
      evaluation.gameFingerprint,
      evaluation.engineName,
      evaluation.engineVersion,
      evaluation.profile,
    ].join("\u0000");
    const group = groups.get(key) ?? {
      gameFingerprint: evaluation.gameFingerprint,
      engineName: evaluation.engineName,
      engineVersion: evaluation.engineVersion,
      profile: evaluation.profile,
      analyzedAt: evaluation.analyzedAt,
      evaluations: [],
    };
    group.analyzedAt = group.analyzedAt.localeCompare(evaluation.analyzedAt) >= 0
      ? group.analyzedAt
      : evaluation.analyzedAt;
    group.evaluations.push(evaluation);
    groups.set(key, group);
  }
  return [...groups.values()]
    .map((group) => ({
      ...group,
      evaluations: group.evaluations.sort(
        (left, right) => left.positionIndex - right.positionIndex,
      ),
    }))
    .sort((left, right) => right.analyzedAt.localeCompare(left.analyzedAt));
}

export class SqliteGameRepository implements GameRepository {
  private database: Database | null = null;

  async initialize(): Promise<void> {
    this.database = await Database.load("sqlite:chessmate.db");
    await this.database.execute(`
      CREATE TABLE IF NOT EXISTS games (
        fingerprint TEXT PRIMARY KEY NOT NULL,
        white_player TEXT NOT NULL,
        black_player TEXT NOT NULL,
        result TEXT NOT NULL,
        played_at TEXT,
        display_date TEXT,
        time_control TEXT,
        source TEXT,
        raw_pgn TEXT NOT NULL,
        moves_json TEXT NOT NULL,
        positions_json TEXT NOT NULL,
        imported_at TEXT NOT NULL
      )
    `);
    await this.database.execute(`
      CREATE TABLE IF NOT EXISTS app_settings (
        key TEXT PRIMARY KEY NOT NULL,
        value TEXT NOT NULL
      )
    `);
    await this.database.execute(`
      CREATE TABLE IF NOT EXISTS position_evaluations (
        game_fingerprint TEXT NOT NULL,
        engine_name TEXT NOT NULL,
        engine_version TEXT NOT NULL,
        profile TEXT NOT NULL,
        position_index INTEGER NOT NULL,
        score_cp INTEGER,
        mate INTEGER,
        depth INTEGER NOT NULL,
        best_move TEXT NOT NULL,
        pv_json TEXT NOT NULL,
        analyzed_at TEXT NOT NULL,
        PRIMARY KEY (
          game_fingerprint, engine_name, engine_version, profile, position_index
        ),
        FOREIGN KEY (game_fingerprint) REFERENCES games(fingerprint) ON DELETE CASCADE
      )
    `);
    await this.database.execute(`
      CREATE TABLE IF NOT EXISTS chess_com_sync_months (
        username TEXT NOT NULL,
        year_month TEXT NOT NULL,
        etag TEXT,
        last_modified TEXT,
        completed_at TEXT,
        checked_at TEXT NOT NULL,
        PRIMARY KEY (username, year_month)
      )
    `);
    await this.database.execute(`
      CREATE TABLE IF NOT EXISTS training_puzzle_progress (
        puzzle_key TEXT PRIMARY KEY NOT NULL,
        attempts INTEGER NOT NULL,
        successes INTEGER NOT NULL,
        last_result TEXT NOT NULL,
        due_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )
    `);
    await this.database.execute(`
      CREATE TABLE IF NOT EXISTS training_activities (
        week_start TEXT NOT NULL,
        kind TEXT NOT NULL,
        item_key TEXT NOT NULL,
        occurred_on TEXT NOT NULL,
        created_at TEXT NOT NULL,
        PRIMARY KEY (week_start, kind, item_key)
      )
    `);
    await this.database.execute(`
      CREATE TABLE IF NOT EXISTS training_days (
        day TEXT PRIMARY KEY NOT NULL
      )
    `);
  }

  private requireDatabase(): Database {
    if (!this.database) {
      throw new Error("Game repository has not been initialized");
    }
    return this.database;
  }

  async listGames(): Promise<StoredGame[]> {
    const rows = await this.requireDatabase().select<GameRow[]>(`
      SELECT * FROM games
      ORDER BY played_at IS NULL ASC, played_at DESC, imported_at DESC
    `);
    return rows.map((row) => ({
      fingerprint: row.fingerprint,
      white: row.white_player,
      black: row.black_player,
      result: row.result,
      playedAt: row.played_at,
      displayDate: row.display_date,
      timeControl: row.time_control,
      source: row.source,
      rawPgn: row.raw_pgn,
      moves: JSON.parse(row.moves_json) as string[],
      positions: JSON.parse(row.positions_json) as string[],
      importedAt: row.imported_at,
    }));
  }

  async addGames(games: ParsedGame[]): Promise<AddGamesResult> {
    const database = this.requireDatabase();
    let added = 0;
    let duplicates = 0;
    const importedAt = new Date().toISOString();

    for (const game of games) {
      const result = await database.execute(
        `INSERT OR IGNORE INTO games (
          fingerprint, white_player, black_player, result, played_at,
          display_date, time_control, source, raw_pgn, moves_json,
          positions_json, imported_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
        [
          game.fingerprint,
          game.white,
          game.black,
          game.result,
          game.playedAt,
          game.displayDate,
          game.timeControl,
          game.source,
          game.rawPgn,
          JSON.stringify(game.moves),
          JSON.stringify(game.positions),
          importedAt,
        ],
      );
      if (result.rowsAffected > 0) {
        added += 1;
      } else {
        duplicates += 1;
      }
    }
    return { added, duplicates };
  }

  async getSetting(key: string): Promise<string | null> {
    const rows = await this.requireDatabase().select<SettingRow[]>(
      "SELECT value FROM app_settings WHERE key = $1",
      [key],
    );
    return rows[0]?.value ?? null;
  }

  async setSetting(key: string, value: string): Promise<void> {
    await this.requireDatabase().execute(
      `INSERT INTO app_settings (key, value) VALUES ($1, $2)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
      [key, value],
    );
  }

  async listChessComSyncStates(username: string): Promise<ChessComMonthSyncState[]> {
    const rows = await this.requireDatabase().select<ChessComSyncRow[]>(
      `SELECT * FROM chess_com_sync_months
       WHERE username = $1 ORDER BY year_month ASC`,
      [username],
    );
    return rows.map((row) => ({
      username: row.username,
      yearMonth: row.year_month,
      etag: row.etag,
      lastModified: row.last_modified,
      completedAt: row.completed_at,
      checkedAt: row.checked_at,
    }));
  }

  async saveChessComSyncState(state: ChessComMonthSyncState): Promise<void> {
    await this.requireDatabase().execute(
      `INSERT INTO chess_com_sync_months (
        username, year_month, etag, last_modified, completed_at, checked_at
      ) VALUES ($1, $2, $3, $4, $5, $6)
      ON CONFLICT(username, year_month) DO UPDATE SET
        etag = excluded.etag,
        last_modified = excluded.last_modified,
        completed_at = excluded.completed_at,
        checked_at = excluded.checked_at`,
      [
        state.username,
        state.yearMonth,
        state.etag,
        state.lastModified,
        state.completedAt,
        state.checkedAt,
      ],
    );
  }

  async listAnalysisCaches(): Promise<StoredAnalysisCache[]> {
    const rows = await this.requireDatabase().select<EvaluationRow[]>(`
      SELECT * FROM position_evaluations
      ORDER BY game_fingerprint, engine_name, engine_version, profile, position_index
    `);
    return groupAnalysisCaches(rows.map(evaluationFromRow));
  }

  async listPuzzleProgress(): Promise<PuzzleProgress[]> {
    const rows = await this.requireDatabase().select<PuzzleProgressRow[]>(`
      SELECT * FROM training_puzzle_progress ORDER BY due_at ASC
    `);
    return rows.map((row) => ({
      puzzleKey: row.puzzle_key,
      attempts: row.attempts,
      successes: row.successes,
      lastResult: row.last_result,
      dueAt: row.due_at,
      updatedAt: row.updated_at,
    }));
  }

  async savePuzzleProgress(progress: PuzzleProgress): Promise<void> {
    await this.requireDatabase().execute(
      `INSERT INTO training_puzzle_progress (
        puzzle_key, attempts, successes, last_result, due_at, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6)
      ON CONFLICT(puzzle_key) DO UPDATE SET
        attempts = excluded.attempts,
        successes = excluded.successes,
        last_result = excluded.last_result,
        due_at = excluded.due_at,
        updated_at = excluded.updated_at`,
      [
        progress.puzzleKey,
        progress.attempts,
        progress.successes,
        progress.lastResult,
        progress.dueAt,
        progress.updatedAt,
      ],
    );
  }

  async recordTrainingActivity(activity: TrainingActivity): Promise<void> {
    const database = this.requireDatabase();
    await database.execute(
      `INSERT OR IGNORE INTO training_activities (
        week_start, kind, item_key, occurred_on, created_at
      ) VALUES ($1, $2, $3, $4, $5)`,
      [
        activity.weekStart,
        activity.kind,
        activity.itemKey,
        activity.occurredOn,
        activity.createdAt,
      ],
    );
    await database.execute(
      "INSERT OR IGNORE INTO training_days (day) VALUES ($1)",
      [activity.occurredOn],
    );
  }

  async listTrainingActivities(weekStart: string): Promise<TrainingActivity[]> {
    const rows = await this.requireDatabase().select<TrainingActivityRow[]>(
      `SELECT * FROM training_activities
       WHERE week_start = $1 ORDER BY created_at ASC`,
      [weekStart],
    );
    return rows.map((row) => ({
      weekStart: row.week_start,
      kind: row.kind,
      itemKey: row.item_key,
      occurredOn: row.occurred_on,
      createdAt: row.created_at,
    }));
  }

  async listTrainingDays(): Promise<string[]> {
    const rows = await this.requireDatabase().select<Array<{ day: string }>>(
      "SELECT day FROM training_days ORDER BY day ASC",
    );
    return rows.map((row) => row.day);
  }

  async getAnalysis(
    gameFingerprint: string,
    engine: EngineInfo,
    profile: AnalysisProfileId,
  ): Promise<StoredPositionEvaluation[]> {
    const rows = await this.requireDatabase().select<EvaluationRow[]>(
      `SELECT * FROM position_evaluations
       WHERE game_fingerprint = $1 AND engine_name = $2
         AND engine_version = $3 AND profile = $4
       ORDER BY position_index ASC`,
      [gameFingerprint, engine.name, engine.version, profile],
    );
    return rows.map(evaluationFromRow);
  }

  async saveEvaluations(
    gameFingerprint: string,
    engine: EngineInfo,
    profile: AnalysisProfileId,
    evaluations: PositionEvaluation[],
  ): Promise<void> {
    const database = this.requireDatabase();
    const analyzedAt = new Date().toISOString();
    for (const evaluation of evaluations) {
      await database.execute(
        `INSERT INTO position_evaluations (
          game_fingerprint, engine_name, engine_version, profile, position_index,
          score_cp, mate, depth, best_move, pv_json, analyzed_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
        ON CONFLICT(game_fingerprint, engine_name, engine_version, profile, position_index)
        DO UPDATE SET score_cp = excluded.score_cp, mate = excluded.mate,
          depth = excluded.depth, best_move = excluded.best_move,
          pv_json = excluded.pv_json, analyzed_at = excluded.analyzed_at`,
        [
          gameFingerprint,
          engine.name,
          engine.version,
          profile,
          evaluation.positionIndex,
          evaluation.scoreCp,
          evaluation.mate,
          evaluation.depth,
          evaluation.bestMove ?? "",
          JSON.stringify(evaluation.pv),
          analyzedAt,
        ],
      );
    }
  }

  async clearAnalysis(
    gameFingerprint: string,
    engine: EngineInfo,
    profile: AnalysisProfileId,
  ): Promise<void> {
    await this.requireDatabase().execute(
      `DELETE FROM position_evaluations
       WHERE game_fingerprint = $1 AND engine_name = $2
         AND engine_version = $3 AND profile = $4`,
      [gameFingerprint, engine.name, engine.version, profile],
    );
  }
}

export function createGameRepository(): GameRepository {
  return isTauri() ? new SqliteGameRepository() : new MemoryGameRepository();
}
