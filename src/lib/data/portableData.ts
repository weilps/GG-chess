import type {
  ChessComMonthSyncState,
  GameRepository,
  PuzzleProgress,
  StoredAnalysisCache,
  TrainingActivity,
} from "../db/gameRepository";
import type { Language, StoredGame, StoredPositionEvaluation } from "../../types";

export const BACKUP_SCHEMA_VERSION = 1 as const;
export const MAX_PORTABLE_FILE_BYTES = 50 * 1024 * 1024;

export const PORTABLE_SETTING_KEYS = [
  "analysisProfile",
  "chessComUsername",
  "trainingPlayerNames",
  "trainingCoachProfile",
] as const;

export type PortableSettingKey = (typeof PORTABLE_SETTING_KEYS)[number];

export interface PortableBackup {
  schemaVersion: typeof BACKUP_SCHEMA_VERSION;
  createdAt: string;
  appVersion: string;
  language: Language;
  games: StoredGame[];
  analysisCaches: StoredAnalysisCache[];
  chessComSyncStates: ChessComMonthSyncState[];
  puzzleProgress: PuzzleProgress[];
  trainingActivities: TrainingActivity[];
  trainingDays: string[];
  settings: Partial<Record<PortableSettingKey, string>>;
}

export interface RestoreSummary {
  added: number;
  updated: number;
  unchanged: number;
  rejected: number;
}

export type PortableDataErrorCode =
  | "tooLarge"
  | "invalidJson"
  | "unsupportedSchema"
  | "invalidData";

export class PortableDataError extends Error {
  constructor(public readonly code: PortableDataErrorCode) {
    super(code);
  }
}

export async function buildPortableBackup(
  repository: GameRepository,
  language: Language,
  appVersion: string,
  now = new Date(),
): Promise<PortableBackup> {
  const [
    games,
    analysisCaches,
    chessComSyncStates,
    puzzleProgress,
    trainingActivities,
    trainingDays,
    ...settingValues
  ] = await Promise.all([
    repository.listGames(),
    repository.listAnalysisCaches(),
    repository.listAllChessComSyncStates(),
    repository.listPuzzleProgress(),
    repository.listAllTrainingActivities(),
    repository.listTrainingDays(),
    ...PORTABLE_SETTING_KEYS.map((key) => repository.getSetting(key)),
  ]);
  const settings: PortableBackup["settings"] = {};
  PORTABLE_SETTING_KEYS.forEach((key, index) => {
    const value = settingValues[index];
    if (typeof value === "string") settings[key] = value;
  });
  return {
    schemaVersion: BACKUP_SCHEMA_VERSION,
    createdAt: now.toISOString(),
    appVersion,
    language,
    games,
    analysisCaches,
    chessComSyncStates,
    puzzleProgress,
    trainingActivities,
    trainingDays,
    settings,
  };
}

export function serializePortableBackup(backup: PortableBackup): string {
  return `${JSON.stringify(backup, null, 2)}\n`;
}

export function parsePortableBackup(contents: string): PortableBackup {
  if (new TextEncoder().encode(contents).byteLength > MAX_PORTABLE_FILE_BYTES) {
    throw new PortableDataError("tooLarge");
  }
  let value: unknown;
  try {
    value = JSON.parse(contents);
  } catch {
    throw new PortableDataError("invalidJson");
  }
  if (!isRecord(value) || value.schemaVersion !== BACKUP_SCHEMA_VERSION) {
    throw new PortableDataError("unsupportedSchema");
  }
  if (!isPortableBackup(value)) throw new PortableDataError("invalidData");
  return value;
}

export function exportPgnArchive(games: StoredGame[]): string {
  if (games.length === 0) return "";
  return `${games.map((game) => game.rawPgn.trim()).filter(Boolean).join("\n\n")}\n`;
}

function isPortableBackup(value: unknown): value is PortableBackup {
  if (!isRecord(value)) return false;
  if (
    value.schemaVersion !== BACKUP_SCHEMA_VERSION
    || !isIsoDate(value.createdAt)
    || !isBoundedString(value.appVersion, 64)
    || (value.language !== "en" && value.language !== "fr")
    || !Array.isArray(value.games)
    || !Array.isArray(value.analysisCaches)
    || !Array.isArray(value.chessComSyncStates)
    || !Array.isArray(value.puzzleProgress)
    || !Array.isArray(value.trainingActivities)
    || !Array.isArray(value.trainingDays)
    || !isRecord(value.settings)
  ) return false;
  if (
    value.games.length > 100_000
    || value.analysisCaches.length > 500_000
    || value.chessComSyncStates.length > 10_000
    || value.puzzleProgress.length > 1_000_000
    || value.trainingActivities.length > 1_000_000
    || value.trainingDays.length > 100_000
  ) return false;
  const games = value.games;
  if (!games.every(isStoredGame)) return false;
  const fingerprints = new Set(games.map((game) => game.fingerprint));
  if (fingerprints.size !== games.length) return false;
  if (!value.analysisCaches.every((cache) => isAnalysisCache(cache, fingerprints))) return false;
  if (!value.chessComSyncStates.every(isChessComSyncState)) return false;
  if (!value.puzzleProgress.every(isPuzzleProgress)) return false;
  if (!value.trainingActivities.every(isTrainingActivity)) return false;
  if (!value.trainingDays.every((day) => isDay(day))) return false;
  const settings = value.settings;
  if (!isRecord(settings)) return false;
  const keys = Object.keys(settings);
  return keys.every((key) => (
    (PORTABLE_SETTING_KEYS as readonly string[]).includes(key)
    && isBoundedString(settings[key], 2_048)
  ));
}

function isStoredGame(value: unknown): value is StoredGame {
  if (!isRecord(value)) return false;
  return isBoundedString(value.fingerprint, 256)
    && isBoundedString(value.white, 512)
    && isBoundedString(value.black, 512)
    && isBoundedString(value.result, 16)
    && isNullableBoundedString(value.playedAt, 64)
    && isNullableBoundedString(value.displayDate, 64)
    && isNullableBoundedString(value.timeControl, 128)
    && isNullableBoundedString(value.source, 256)
    && typeof value.rawPgn === "string"
    && value.rawPgn.length <= 10_000_000
    && isStringArray(value.moves, 2_000, 64)
    && isStringArray(value.positions, 2_001, 256)
    && value.positions.length === value.moves.length + 1
    && isIsoDate(value.importedAt);
}

function isAnalysisCache(value: unknown, fingerprints: Set<string>): value is StoredAnalysisCache {
  if (!isRecord(value)) return false;
  if (
    !isBoundedString(value.gameFingerprint, 256)
    || !fingerprints.has(value.gameFingerprint)
    || !isBoundedString(value.engineName, 256)
    || !isBoundedString(value.engineVersion, 128)
    || !["quick", "balanced", "deep"].includes(String(value.profile))
    || !isIsoDate(value.analyzedAt)
    || !Array.isArray(value.evaluations)
    || value.evaluations.length > 2_001
  ) return false;
  return value.evaluations.every((evaluation) => isEvaluation(evaluation, value));
}

function isEvaluation(value: unknown, cache: Record<string, unknown>): value is StoredPositionEvaluation {
  if (!isRecord(value)) return false;
  return value.gameFingerprint === cache.gameFingerprint
    && value.engineName === cache.engineName
    && value.engineVersion === cache.engineVersion
    && value.profile === cache.profile
    && Number.isInteger(value.positionIndex)
    && Number(value.positionIndex) >= 0
    && isNullableInteger(value.scoreCp)
    && isNullableInteger(value.mate)
    && Number.isInteger(value.depth)
    && Number(value.depth) >= 0
    && isNullableBoundedString(value.bestMove, 16)
    && isStringArray(value.pv, 512, 16)
    && isIsoDate(value.analyzedAt);
}

function isChessComSyncState(value: unknown): value is ChessComMonthSyncState {
  if (!isRecord(value)) return false;
  return isBoundedString(value.username, 128)
    && typeof value.yearMonth === "string"
    && /^\d{4}\/\d{2}$/.test(value.yearMonth)
    && isNullableBoundedString(value.etag, 2_048)
    && isNullableBoundedString(value.lastModified, 256)
    && (value.completedAt === null || isIsoDate(value.completedAt))
    && isIsoDate(value.checkedAt);
}

function isPuzzleProgress(value: unknown): value is PuzzleProgress {
  if (!isRecord(value)) return false;
  return isBoundedString(value.puzzleKey, 2_048)
    && Number.isInteger(value.attempts)
    && Number(value.attempts) >= 0
    && Number.isInteger(value.successes)
    && Number(value.successes) >= 0
    && ["incorrect", "revealed", "again", "good", "easy"].includes(String(value.lastResult))
    && isIsoDate(value.dueAt)
    && isIsoDate(value.updatedAt);
}

function isTrainingActivity(value: unknown): value is TrainingActivity {
  if (!isRecord(value)) return false;
  return isDay(value.weekStart)
    && ["review", "puzzle", "opening"].includes(String(value.kind))
    && isBoundedString(value.itemKey, 2_048)
    && isDay(value.occurredOn)
    && isIsoDate(value.createdAt);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isStringArray(value: unknown, maxItems: number, maxLength: number): value is string[] {
  return Array.isArray(value)
    && value.length <= maxItems
    && value.every((item) => isBoundedString(item, maxLength));
}

function isBoundedString(value: unknown, maxLength: number): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= maxLength;
}

function isNullableBoundedString(value: unknown, maxLength: number): value is string | null {
  return value === null || (typeof value === "string" && value.length <= maxLength);
}

function isNullableInteger(value: unknown): value is number | null {
  return value === null || Number.isInteger(value);
}

function isIsoDate(value: unknown): value is string {
  return typeof value === "string"
    && value.length <= 64
    && Number.isFinite(Date.parse(value));
}

function isDay(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
}
