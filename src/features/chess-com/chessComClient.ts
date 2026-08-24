import { invoke, isTauri } from "@tauri-apps/api/core";
import type { ImportRejection, ParsedGame } from "../../types";
import type {
  ChessComMonthSyncState,
  GameRepository,
} from "../../lib/db/gameRepository";
import { parsePgnArchive } from "../../lib/pgn/parsePgnArchive";

const USERNAME_SETTING = "chessComUsername";
const ARCHIVES_SETTING_PREFIX = "chessComArchives:";

export interface ChessComArchiveResponse {
  notModified: boolean;
  months: string[];
  etag: string | null;
  lastModified: string | null;
}

export interface ChessComGamePayload {
  pgn: string;
  rules: string;
}

export interface ChessComMonthResponse {
  notModified: boolean;
  games: ChessComGamePayload[];
  etag: string | null;
  lastModified: string | null;
}

export interface ChessComSyncProgress {
  current: number;
  total: number;
  yearMonth: string;
}

export interface ChessComSyncSummary {
  added: number;
  duplicates: number;
  rejections: ImportRejection[];
  variantsIgnored: number;
  monthsChecked: number;
  monthsUnchanged: number;
  monthsSkipped: number;
  cancelled: boolean;
}

export class ChessComSyncError extends Error {
  constructor(
    public readonly causeCode: string,
    public readonly summary: ChessComSyncSummary,
  ) {
    super(causeCode);
    this.name = "ChessComSyncError";
  }
}

interface ArchiveCache {
  months: string[];
  etag: string | null;
  lastModified: string | null;
}

export interface ChessComTransport {
  fetchArchives(request: {
    username: string;
    etag: string | null;
    lastModified: string | null;
  }): Promise<ChessComArchiveResponse>;
  fetchMonth(request: {
    username: string;
    year: number;
    month: number;
    etag: string | null;
    lastModified: string | null;
  }): Promise<ChessComMonthResponse>;
}

interface SyncOptions {
  username: string;
  repository: GameRepository;
  transport?: ChessComTransport;
  isCancelled?: () => boolean;
  onProgress?: (progress: ChessComSyncProgress) => void;
  now?: () => string;
}

export function normalizeChessComUsername(value: string): string {
  const normalized = value.trim().toLowerCase();
  if (
    normalized.length === 0
    || normalized.length > 25
    || !/^[a-z0-9](?:[a-z0-9_-]{0,23}[a-z0-9])?$/.test(normalized)
  ) {
    throw new Error("chess_com_invalid_username");
  }
  return normalized;
}

export function chessComImportAvailable(): boolean {
  return isTauri();
}

export async function getSavedChessComUsername(
  repository: GameRepository,
): Promise<string> {
  return (await repository.getSetting(USERNAME_SETTING)) ?? "";
}

export async function syncChessComGames({
  username: inputUsername,
  repository,
  transport = nativeTransport,
  isCancelled = () => false,
  onProgress,
  now = () => new Date().toISOString(),
}: SyncOptions): Promise<ChessComSyncSummary> {
  const username = normalizeChessComUsername(inputUsername);
  await repository.setSetting(USERNAME_SETTING, username);

  const cachedArchives = parseArchiveCache(
    await repository.getSetting(`${ARCHIVES_SETTING_PREFIX}${username}`),
  );
  const archiveResponse = await transport.fetchArchives({
    username,
    etag: cachedArchives?.etag ?? null,
    lastModified: cachedArchives?.lastModified ?? null,
  });
  const archiveCache = resolveArchiveCache(cachedArchives, archiveResponse);
  await repository.setSetting(
    `${ARCHIVES_SETTING_PREFIX}${username}`,
    JSON.stringify(archiveCache),
  );

  const summary: ChessComSyncSummary = {
    added: 0,
    duplicates: 0,
    rejections: [],
    variantsIgnored: 0,
    monthsChecked: 0,
    monthsUnchanged: 0,
    monthsSkipped: 0,
    cancelled: false,
  };
  const months = [...archiveCache.months].sort();
  const latestMonth = months.at(-1) ?? null;
  const savedStates = await repository.listChessComSyncStates(username);
  const states = new Map(savedStates.map((state) => [state.yearMonth, state]));
  let gameNumber = 0;

  for (const [index, yearMonth] of months.entries()) {
    const previous = states.get(yearMonth);
    if (previous?.completedAt && yearMonth !== latestMonth) {
      summary.monthsSkipped += 1;
      continue;
    }
    if (isCancelled()) {
      summary.cancelled = true;
      break;
    }

    onProgress?.({ current: index + 1, total: months.length, yearMonth });
    const [year, month] = parseYearMonth(yearMonth);
    let response: ChessComMonthResponse;
    try {
      response = await transport.fetchMonth({
        username,
        year,
        month,
        etag: previous?.etag ?? null,
        lastModified: previous?.lastModified ?? null,
      });
    } catch (error) {
      const causeCode = error instanceof Error ? error.message : String(error);
      throw new ChessComSyncError(causeCode, summary);
    }
    summary.monthsChecked += 1;
    const checkedAt = now();
    if (response.notModified) {
      summary.monthsUnchanged += 1;
      const state = makeSyncState(
        username,
        yearMonth,
        response.etag ?? previous?.etag ?? null,
        response.lastModified ?? previous?.lastModified ?? null,
        yearMonth === latestMonth ? null : (previous?.completedAt ?? checkedAt),
        checkedAt,
      );
      await repository.saveChessComSyncState(state);
      states.set(yearMonth, state);
      continue;
    }

    const parsedGames: ParsedGame[] = [];
    for (const payload of response.games) {
      gameNumber += 1;
      if (payload.rules.toLowerCase() !== "chess") {
        summary.variantsIgnored += 1;
        continue;
      }
      const report = parsePgnArchive(payload.pgn);
      for (const rejection of report.rejections) {
        summary.rejections.push({ ...rejection, gameNumber });
      }
      for (const game of report.games) {
        if (game.result === "*") {
          summary.rejections.push({ gameNumber, reason: "invalidPgn" });
        } else {
          parsedGames.push(game);
        }
      }
    }
    const added = await repository.addGames(parsedGames);
    summary.added += added.added;
    summary.duplicates += added.duplicates;

    const state = makeSyncState(
      username,
      yearMonth,
      response.etag,
      response.lastModified,
      yearMonth === latestMonth ? null : checkedAt,
      checkedAt,
    );
    await repository.saveChessComSyncState(state);
    states.set(yearMonth, state);
  }
  return summary;
}

function makeSyncState(
  username: string,
  yearMonth: string,
  etag: string | null,
  lastModified: string | null,
  completedAt: string | null,
  checkedAt: string,
): ChessComMonthSyncState {
  return { username, yearMonth, etag, lastModified, completedAt, checkedAt };
}

function parseYearMonth(value: string): [number, number] {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(value)) {
    throw new Error("chess_com_invalid_response");
  }
  const [year, month] = value.split("-").map(Number);
  return [year, month];
}

function parseArchiveCache(value: string | null): ArchiveCache | null {
  if (!value) return null;
  try {
    const candidate = JSON.parse(value) as Partial<ArchiveCache>;
    if (
      !Array.isArray(candidate.months)
      || !candidate.months.every((month) => /^\d{4}-(0[1-9]|1[0-2])$/.test(month))
      || !(typeof candidate.etag === "string" || candidate.etag === null)
      || !(typeof candidate.lastModified === "string" || candidate.lastModified === null)
    ) {
      return null;
    }
    return {
      months: [...new Set(candidate.months)].sort(),
      etag: candidate.etag,
      lastModified: candidate.lastModified,
    };
  } catch {
    return null;
  }
}

function resolveArchiveCache(
  cached: ArchiveCache | null,
  response: ChessComArchiveResponse,
): ArchiveCache {
  if (response.notModified) {
    if (!cached) throw new Error("chess_com_invalid_response");
    return {
      months: cached.months,
      etag: response.etag ?? cached.etag,
      lastModified: response.lastModified ?? cached.lastModified,
    };
  }
  if (!response.months.every((month) => /^\d{4}-(0[1-9]|1[0-2])$/.test(month))) {
    throw new Error("chess_com_invalid_response");
  }
  return {
    months: [...new Set(response.months)].sort(),
    etag: response.etag,
    lastModified: response.lastModified,
  };
}

const nativeTransport: ChessComTransport = {
  fetchArchives: (request) => invoke("chess_com_fetch_archives", { request }),
  fetchMonth: (request) => invoke("chess_com_fetch_month", { request }),
};
