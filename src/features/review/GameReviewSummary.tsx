import type { TranslationKey } from "../../i18n/translations";
import type { GameAccuracy, MoveClassification } from "../../types";
import { formatCentipawnLoss } from "../classification/classifyMoves";
import { AccuracySummary, MoveRatingBadge } from "../classification/MoveRatings";
import { RatingIcon } from "../classification/RatingIcon";
import { ratingLabel } from "../classification/ratingPresentation";
import {
  countClassifications,
  findCriticalMoments,
  SUMMARY_CLASSIFICATIONS,
} from "./gameReview";

type Translate = (key: TranslationKey, variables?: Record<string, string | number>) => string;

export function GameReviewSummary({
  ratings,
  accuracy,
  onSelectPosition,
  t,
}: {
  ratings: MoveClassification[];
  accuracy: GameAccuracy;
  onSelectPosition: (positionIndex: number) => void;
  t: Translate;
}) {
  const counts = countClassifications(ratings);
  const criticalMoments = findCriticalMoments(ratings);

  return (
    <section className="game-review-summary" aria-label={t("gameReviewSummary")}>
      <div className="summary-accuracy">
        <AccuracySummary accuracy={accuracy} t={t} />
      </div>
      <div className="classification-breakdown">
        <div className="game-review-heading">
          <strong>{t("classificationBreakdown")}</strong>
        </div>
        <div className="classification-sides">
          {(["white", "black"] as const).map((color) => (
            <div className="classification-side" key={color}>
              <strong>{t(color)}</strong>
              <div className="classification-counts">
                {SUMMARY_CLASSIFICATIONS.map((classification) => (
                  <span
                    key={classification}
                    title={ratingLabel(classification, t)}
                    data-testid={`classification-${color}-${classification}`}
                  >
                    <span className={`summary-rating-icon rating-${classification}`} aria-hidden="true">
                      <RatingIcon classification={classification} decorative />
                    </span>
                    <b>{counts[color][classification]}</b>
                    <small>{ratingLabel(classification, t)}</small>
                  </span>
                ))}
              </div>
              <span className="not-rated-count" data-testid={`not-rated-${color}`}>
                {t("notRatedMoves", { count: counts[color].notRated })}
              </span>
            </div>
          ))}
        </div>
      </div>
      <div className="critical-moments">
        <div className="game-review-heading">
          <strong>{t("criticalMoments")}</strong>
          <small>{t("criticalMomentsHint")}</small>
        </div>
        {criticalMoments.length === 0 ? (
          <p className="game-review-empty">{t("criticalMomentsEmpty")}</p>
        ) : (
          <div className="critical-moment-list">
            {criticalMoments.map((rating) => {
              const moveNumber = Math.floor(rating.moveIndex / 2) + 1;
              const player = t(rating.color);
              return (
                <button
                  key={rating.moveIndex}
                  onClick={() => onSelectPosition(rating.positionIndex)}
                  aria-label={t("criticalMomentLabel", {
                    player,
                    number: moveNumber,
                    move: rating.san,
                    rating: ratingLabel(rating.classification, t),
                    loss: formatCentipawnLoss(rating.centipawnLoss),
                  })}
                >
                  <MoveRatingBadge rating={rating} t={t} />
                  <span>
                    <strong>{player} · {moveNumber}{rating.color === "black" ? "…" : "."} {rating.san}</strong>
                    <small>{ratingLabel(rating.classification, t)}</small>
                  </span>
                  <b>{formatCentipawnLoss(rating.centipawnLoss)}</b>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </section>
  );
}
