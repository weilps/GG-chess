export type Language = "en" | "fr";

export type MoveNotationMode = "pieces" | "san";

export type RejectionReason =
  | "emptyFile"
  | "invalidPgn"
  | "unsupportedVariant";

export interface ImportRejection {
  gameNumber: number;
  reason: RejectionReason;
  detail?: string;
}

export interface ParsedGame {
  fingerprint: string;
  white: string;
  black: string;
  result: string;
  playedAt: string | null;
  displayDate: string | null;
  timeControl: string | null;
  source: string | null;
  rawPgn: string;
  moves: string[];
  positions: string[];
}

export interface StoredGame extends ParsedGame {
  importedAt: string;
}

export interface ParseReport {
  games: ParsedGame[];
  rejections: ImportRejection[];
}

export interface ImportSummary {
  added: number;
  duplicates: number;
  rejections: ImportRejection[];
}

export type AnalysisProfileId = "quick" | "balanced" | "deep";
export type MultiPv = 1 | 2 | 3;
export type GuidanceMode = "next" | "compare";

export interface AnalysisProfile {
  id: AnalysisProfileId;
  depth: number;
}

export interface EngineInfo {
  path: string;
  name: string;
  version: string;
}

export interface RankedVariation {
  rank: MultiPv;
  scoreCp: number | null;
  mate: number | null;
  depth: number;
  bestMove: string | null;
  pv: string[];
}

export interface PositionEvaluation extends Omit<RankedVariation, "rank"> {
  positionIndex: number;
  variations: RankedVariation[];
}

export interface StoredPositionEvaluation extends PositionEvaluation {
  gameFingerprint: string;
  engineName: string;
  engineVersion: string;
  profile: AnalysisProfileId;
  multiPv: MultiPv;
  analyzedAt: string;
}

export interface AnalysisSnapshot {
  cacheKey: string | null;
  evaluations: PositionEvaluation[];
  engineStatus: "loading" | "ready" | "missing" | "error";
  loading: boolean;
  profile: AnalysisProfileId;
  multiPv: MultiPv;
  guidanceEnabled: boolean;
  guidanceMode: GuidanceMode;
}

export type MoveClassificationId =
  | "brilliant"
  | "great"
  | "best"
  | "excellent"
  | "good"
  | "inaccuracy"
  | "mistake"
  | "miss"
  | "blunder"
  | "notRated";

export type MoveClassificationReason =
  | "brilliantSacrifice"
  | "greatMate"
  | "greatRecovery"
  | "engineBest"
  | "missedWin"
  | "centipawnLoss"
  | "missingEvaluation"
  | "invalidMove";

export interface MoveClassification {
  moveIndex: number;
  positionIndex: number;
  color: "white" | "black";
  san: string;
  uci: string | null;
  classification: MoveClassificationId;
  reason: MoveClassificationReason;
  centipawnLoss: number | null;
}

export interface CandidateMoveClassification {
  rank: MultiPv;
  uci: string | null;
  classification: MoveClassificationId;
  reason: MoveClassificationReason;
  centipawnLoss: number | null;
}

export interface GameAccuracy {
  white: number | null;
  black: number | null;
}
