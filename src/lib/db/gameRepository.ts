import { isTauri } from "@tauri-apps/api/core";
import Database from "@tauri-apps/plugin-sql";
import type { ParsedGame, StoredGame } from "../../types";

export interface AddGamesResult {
  added: number;
  duplicates: number;
}

export interface GameRepository {
  initialize(): Promise<void>;
  listGames(): Promise<StoredGame[]>;
  addGames(games: ParsedGame[]): Promise<AddGamesResult>;
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
}

export function createGameRepository(): GameRepository {
  return isTauri() ? new SqliteGameRepository() : new MemoryGameRepository();
}
