import type { KeyboardEvent } from "react";
import type { TranslationKey } from "../../i18n/translations";
import type { MoveClassification, PositionEvaluation } from "../../types";
import { RatingIcon, RatingIconGlyph } from "../classification/RatingIcon";
import { ratingLabel } from "../classification/ratingPresentation";
import {
  buildEvaluationSegments,
  formatWhiteEvaluation,
  SUMMARY_CLASSIFICATIONS,
} from "./gameReview";

const WIDTH = 720;
const HEIGHT = 190;
const LEFT = 34;
const RIGHT = 12;
const TOP = 12;
const BOTTOM = 24;

type Translate = (key: TranslationKey, variables?: Record<string, string | number>) => string;

function pointX(positionIndex: number, positionCount: number): number {
  return LEFT + (positionIndex / Math.max(1, positionCount - 1)) * (WIDTH - LEFT - RIGHT);
}

function pointY(value: number): number {
  return TOP + ((10 - value) / 20) * (HEIGHT - TOP - BOTTOM);
}

function pointLabel(
  positionIndex: number,
  evaluation: PositionEvaluation,
  moves: string[],
  gameResult: string,
  t: Translate,
  rating?: MoveClassification,
): string {
  const formatted = formatWhiteEvaluation(evaluation, gameResult);
  const base = positionIndex === 0
    ? t("chartStartingPosition", { evaluation: formatted })
    : t("chartMovePosition", {
    position: positionIndex,
    move: moves[positionIndex - 1] ?? "—",
    evaluation: formatted,
  });
  return rating ? `${base}, ${ratingLabel(rating.classification, t)}` : base;
}

export function EvaluationChart({
  compact = false,
  evaluations,
  ratings,
  moves,
  gameResult,
  selectedPositionIndex,
  onSelectPosition,
  t,
}: {
  compact?: boolean;
  evaluations: PositionEvaluation[];
  ratings: MoveClassification[];
  moves: string[];
  gameResult: string;
  selectedPositionIndex: number;
  onSelectPosition: (positionIndex: number) => void;
  t: Translate;
}) {
  const positionCount = moves.length + 1;
  const segments = buildEvaluationSegments(evaluations, positionCount, gameResult);
  const ratingByPosition = new Map(ratings.map((rating) => [rating.positionIndex, rating]));
  const points = segments.flat();
  const selectedPoint = points.find((point) => point.positionIndex === selectedPositionIndex);
  const activate = (event: KeyboardEvent<SVGGElement>, positionIndex: number) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      onSelectPosition(positionIndex);
      return;
    }
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    event.stopPropagation();
    const currentIndex = points.findIndex((point) => point.positionIndex === positionIndex);
    const targetIndex = event.key === "Home"
      ? 0
      : event.key === "End"
        ? points.length - 1
        : Math.min(points.length - 1, Math.max(0, currentIndex + (event.key === "ArrowLeft" ? -1 : 1)));
    const targetPosition = points[targetIndex].positionIndex;
    const chart = event.currentTarget.ownerSVGElement;
    onSelectPosition(targetPosition);
    window.requestAnimationFrame(() => {
      chart?.querySelector<SVGGElement>(`[data-position-index="${targetPosition}"]`)?.focus();
    });
  };

  return (
    <section className={`evaluation-chart-card${compact ? " compact" : ""}`} aria-label={t("evaluationGraph")}>
      <div className="game-review-heading">
        <div>
          <span className="eyebrow">{t("gameReview")}</span>
          <strong>{t("evaluationGraph")}</strong>
        </div>
        <small>{t("whitePerspective")}</small>
      </div>
      {points.length === 0 ? (
        <p className="game-review-empty">{t("evaluationGraphEmpty")}</p>
      ) : (
        <svg
          className="evaluation-chart"
          viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
          role="group"
          aria-label={t("evaluationGraphDescription")}
        >
          {[10, 0, -10].map((tick) => (
            <g key={tick}>
              <line
                className={tick === 0 ? "chart-zero-line" : "chart-grid-line"}
                x1={LEFT}
                x2={WIDTH - RIGHT}
                y1={pointY(tick)}
                y2={pointY(tick)}
              />
              <text x={LEFT - 7} y={pointY(tick) + 4} textAnchor="end">
                {tick > 0 ? `+${tick}` : tick}
              </text>
            </g>
          ))}
          {segments.map((segment) => (
            <path
              className="evaluation-line"
              key={segment.map((point) => point.positionIndex).join("-")}
              d={segment.map((point, index) => (
                `${index === 0 ? "M" : "L"}${pointX(point.positionIndex, positionCount)} ${pointY(point.value)}`
              )).join(" ")}
            />
          ))}
          {selectedPoint ? (
            <line
              aria-hidden="true"
              className="chart-selection-line"
              x1={pointX(selectedPoint.positionIndex, positionCount)}
              x2={pointX(selectedPoint.positionIndex, positionCount)}
              y1={TOP}
              y2={HEIGHT - BOTTOM}
            />
          ) : null}
          {points.map((point) => {
            const rating = ratingByPosition.get(point.positionIndex);
            const selected = point.positionIndex === selectedPositionIndex;
            return (
              <g
                key={point.positionIndex}
                className="evaluation-point-target"
                data-position-index={point.positionIndex}
                role="button"
                tabIndex={0}
                aria-current={selected ? "true" : undefined}
                aria-label={pointLabel(point.positionIndex, point.evaluation, moves, gameResult, t, rating)}
                onClick={() => onSelectPosition(point.positionIndex)}
                onKeyDown={(event) => activate(event, point.positionIndex)}
              >
                <circle
                  className="evaluation-point-hit"
                  cx={pointX(point.positionIndex, positionCount)}
                  cy={pointY(point.value)}
                  r={1}
                  fill="transparent"
                  stroke="transparent"
                  strokeWidth={44}
                  vectorEffect="non-scaling-stroke"
                  pointerEvents="all"
                />
                {selected ? (
                  <circle
                    aria-hidden="true"
                    className="chart-selection-ring"
                    cx={pointX(point.positionIndex, positionCount)}
                    cy={pointY(point.value)}
                    r={12}
                    pointerEvents="none"
                  />
                ) : null}
                <circle
                  aria-hidden="true"
                  className={`evaluation-point ${rating ? `rating-${rating.classification}` : "chart-neutral"}${selected ? " selected-chart-point" : ""}`}
                  cx={pointX(point.positionIndex, positionCount)}
                  cy={pointY(point.value)}
                  r={selected ? 8 : 7}
                  pointerEvents="none"
                />
                {rating ? (
                  <g
                    aria-hidden="true"
                    className={`chart-rating-glyph rating-tone-${rating.classification}`}
                    transform={`translate(${pointX(point.positionIndex, positionCount) - 5} ${pointY(point.value) - 5}) scale(.4167)`}
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.4"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    pointerEvents="none"
                  >
                    <RatingIconGlyph classification={rating.classification} />
                  </g>
                ) : null}
              </g>
            );
          })}
        </svg>
      )}
      <div className="chart-legend" aria-label={t("chartLegend")}>
        {SUMMARY_CLASSIFICATIONS.map((classification) => (
          <span key={classification}>
            <span className={`chart-legend-icon rating-${classification}`} aria-hidden="true">
              <RatingIcon classification={classification} decorative />
            </span>
            {ratingLabel(classification, t)}
          </span>
        ))}
      </div>
    </section>
  );
}
