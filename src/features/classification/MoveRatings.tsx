import type { TranslationKey } from "../../i18n/translations";
import type {
  GameAccuracy,
  MoveClassification,
} from "../../types";
import { formatCentipawnLoss } from "./classifyMoves";
import { RATING_REASON_KEYS, RATING_SYMBOLS, ratingLabel } from "./ratingPresentation";

type Translate = (key: TranslationKey, variables?: Record<string, string | number>) => string;

export function MoveRatingBadge({ rating, t }: { rating: MoveClassification; t: Translate }) {
  const label = ratingLabel(rating.classification, t);
  return (
    <span
      className={`move-rating-badge rating-${rating.classification}`}
      title={label}
      aria-label={label}
    >
      {RATING_SYMBOLS[rating.classification]}
    </span>
  );
}

function accuracyValue(value: number | null): string {
  return value === null ? "—" : value.toFixed(1);
}

export function AccuracySummary({ accuracy, t }: {
  accuracy: GameAccuracy;
  t: Translate;
}) {
  return (
    <>
      <div className="accuracy-heading">
        <span className="eyebrow">{t("chessMateAccuracy")}</span>
        <small>{t("accuracyIndependentFormula")}</small>
      </div>
      <div className="accuracy-sides">
        <div><span>{t("white")}</span><strong>{accuracyValue(accuracy.white)}</strong></div>
        <div><span>{t("black")}</span><strong>{accuracyValue(accuracy.black)}</strong></div>
      </div>
    </>
  );
}

export function MoveRatingDetail({ selected, t }: {
  selected: MoveClassification | null;
  t: Translate;
}) {
  return (
    <div className="selected-rating" data-testid="selected-move-rating">
        {selected ? (
          <>
            <MoveRatingBadge rating={selected} t={t} />
            <div>
              <strong>{ratingLabel(selected.classification, t)}</strong>
              <span>
                {selected.centipawnLoss === null
                  ? t(RATING_REASON_KEYS[selected.reason])
                  : `${formatCentipawnLoss(selected.centipawnLoss)} · ${t(RATING_REASON_KEYS[selected.reason])}`}
              </span>
            </div>
          </>
        ) : (
          <span className="rating-empty">{t("selectMoveForRating")}</span>
        )}
    </div>
  );
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
      <AccuracySummary accuracy={accuracy} t={t} />
      <MoveRatingDetail selected={selected} t={t} />
    </section>
  );
}
