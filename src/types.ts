export type Language = "en" | "fr";

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
