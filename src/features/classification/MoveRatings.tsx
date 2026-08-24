import type { TranslationKey } from "../../i18n/translations";
import type {
  GameAccuracy,
  MoveClassification,
  MoveClassificationId,
  MoveClassificationReason,
} from "../../types";
import { formatCentipawnLoss } from "./classifyMoves";

const LABEL_KEYS: Record<MoveClassificationId, TranslationKey> = {
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

const REASON_KEYS: Record<MoveClassificationReason, TranslationKey> = {
  brilliantSacrifice: "ratingReasonBrilliantSacrifice",
  greatMate: "ratingReasonGreatMate",
  greatRecovery: "ratingReasonGreatRecovery",
  engineBest: "ratingReasonEngineBest",
  missedWin: "ratingReasonMissedWin",
  centipawnLoss: "ratingReasonCentipawnLoss",
  missingEvaluation: "ratingReasonMissingEvaluation",
  invalidMove: "ratingReasonInvalidMove",
};

const SYMBOLS: Record<MoveClassificationId, string> = {
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

function ratingLabel(rating: MoveClassificationId, t: Translate): string {
  return t(LABEL_KEYS[rating]);
}

export function MoveRatingBadge({ rating, t }: { rating: MoveClassification; t: Translate }) {
  const label = ratingLabel(rating.classification, t);
  return (
    <span
      className={`move-rating-badge rating-${rating.classification}`}
      title={label}
      aria-label={label}
    >
      {SYMBOLS[rating.classification]}
    </span>
  );
}

function accuracyValue(value: number | null): string {
  return value === null ? "—" : value.toFixed(1);
}

export function MoveRatingsSummary({
  accuracy,
  selected,
  t,
}: {
  accuracy: GameAccuracy;
  selected: MoveClassification | null;
  t: Translate;
}) {
  return (
    <section className="move-ratings" aria-label={t("chessMateAccuracy")}>
      <div className="accuracy-heading">
        <span className="eyebrow">{t("chessMateAccuracy")}</span>
        <small>{t("accuracyIndependentFormula")}</small>
      </div>
      <div className="accuracy-sides">
        <div><span>{t("white")}</span><strong>{accuracyValue(accuracy.white)}</strong></div>
        <div><span>{t("black")}</span><strong>{accuracyValue(accuracy.black)}</strong></div>
      </div>
      <div className="selected-rating" data-testid="selected-move-rating">
        {selected ? (
          <>
            <MoveRatingBadge rating={selected} t={t} />
            <div>
              <strong>{ratingLabel(selected.classification, t)}</strong>
              <span>
                {selected.centipawnLoss === null
                  ? t(REASON_KEYS[selected.reason])
                  : `${formatCentipawnLoss(selected.centipawnLoss)} · ${t(REASON_KEYS[selected.reason])}`}
              </span>
            </div>
          </>
        ) : (
          <span className="rating-empty">{t("selectMoveForRating")}</span>
        )}
      </div>
    </section>
  );
}
