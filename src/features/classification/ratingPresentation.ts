import type { TranslationKey } from "../../i18n/translations";
import type { MoveClassificationId, MoveClassificationReason } from "../../types";

export const RATING_LABEL_KEYS: Record<MoveClassificationId, TranslationKey> = {
  brilliant: "ratingBrilliant",
  great: "ratingGreat",
  best: "ratingBest",
  excellent: "ratingExcellent",
  good: "ratingGood",
  inaccuracy: "ratingInaccuracy",
  mistake: "ratingMistake",
  miss: "ratingMiss",
  blunder: "ratingBlunder",
  notRated: "ratingNotRated",
};

export const RATING_REASON_KEYS: Record<MoveClassificationReason, TranslationKey> = {
  brilliantSacrifice: "ratingReasonBrilliantSacrifice",
  greatMate: "ratingReasonGreatMate",
  greatRecovery: "ratingReasonGreatRecovery",
  engineBest: "ratingReasonEngineBest",
  missedWin: "ratingReasonMissedWin",
  centipawnLoss: "ratingReasonCentipawnLoss",
  missingEvaluation: "ratingReasonMissingEvaluation",
  invalidMove: "ratingReasonInvalidMove",
};

export const RATING_SYMBOLS: Record<MoveClassificationId, string> = {
  brilliant: "!!",
  great: "!",
  best: "★",
  excellent: "✓+",
  good: "✓",
  inaccuracy: "?!",
  mistake: "?",
  miss: "×",
  blunder: "??",
  notRated: "—",
};

type Translate = (key: TranslationKey, variables?: Record<string, string | number>) => string;

export function ratingLabel(rating: MoveClassificationId, t: Translate): string {
  return t(RATING_LABEL_KEYS[rating]);
}
