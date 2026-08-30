import type { KeyboardEvent, MouseEvent } from "react";
import type { TranslationKey } from "../../i18n/translations";
import type { MoveClassification, PositionEvaluation } from "../../types";
import { RatingIcon } from "../classification/RatingIcon";
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
// The compact plot is at least 111px high. A 38-unit inset keeps a fixed 44px
// target inside the plot while leaving substantially more vertical range.
const COMPACT_VERTICAL_INSET = 38;
// The compact card contributes 10px of padding on each side. Matching the
// 34-unit left inset on the right keeps the 44px hit stroke clear at 320px+.
const COMPACT_RIGHT = 34;

type Translate = (key: TranslationKey, variables?: Record<string, string | number>) => string;

function chartRight(compact: boolean): number {
  return compact ? COMPACT_RIGHT : RIGHT;
}

function pointX(positionIndex: number, positionCount: number, compact: boolean): number {
  return LEFT + (positionIndex / Math.max(1, positionCount - 1)) * (WIDTH - LEFT - chartRight(compact));
}

function chartTop(compact: boolean): number {
  return compact ? COMPACT_VERTICAL_INSET : TOP;
}

function chartBottom(compact: boolean): number {
  return compact ? COMPACT_VERTICAL_INSET : BOTTOM;
}

function pointY(value: number, compact: boolean): number {
  const top = chartTop(compact);
  const bottom = chartBottom(compact);
  return top + ((10 - value) / 20) * (HEIGHT - top - bottom);
}

function chartPercent(value: number, total: number): string {
  return `${(value / total) * 100}%`;
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
  const selectNearestPoint = (event: MouseEvent<HTMLDivElement>) => {
    // Point buttons intentionally ignore pointer hit-testing: in long games their
    // 44px accessibility targets overlap. Route pointer clicks through the whole
    // plot and choose the visually nearest point instead.
    if (event.target !== event.currentTarget) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    if (bounds.width <= 0 || bounds.height <= 0) return;

    const nearest = points.reduce<{ positionIndex: number; distanceSquared: number } | null>((best, point) => {
      const screenX = bounds.left + pointX(point.positionIndex, positionCount, compact) / WIDTH * bounds.width;
      const screenY = bounds.top + pointY(point.value, compact) / HEIGHT * bounds.height;
      const distanceSquared = (event.clientX - screenX) ** 2 + (event.clientY - screenY) ** 2;
      return best === null || distanceSquared < best.distanceSquared
        ? { positionIndex: point.positionIndex, distanceSquared }
        : best;
    }, null);

    if (nearest) onSelectPosition(nearest.positionIndex);
  };
  const activate = (event: KeyboardEvent<HTMLButtonElement>, positionIndex: number) => {
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
    const chart = event.currentTarget.parentElement;
    onSelectPosition(targetPosition);
    window.requestAnimationFrame(() => {
      chart?.querySelector<HTMLButtonElement>(`[data-position-index="${targetPosition}"]`)?.focus();
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
        <div
          className="evaluation-chart-stage"
          role="group"
          aria-label={t("evaluationGraphDescription")}
          onClick={selectNearestPoint}
        >
          <svg
            aria-hidden="true"
            className="evaluation-chart"
            focusable="false"
            preserveAspectRatio="none"
            viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
          >
            {[10, 0, -10].map((tick) => (
              <line
                className={tick === 0 ? "chart-zero-line" : "chart-grid-line"}
                key={tick}
                x1={LEFT}
                x2={WIDTH - chartRight(compact)}
                y1={pointY(tick, compact)}
                y2={pointY(tick, compact)}
              />
            ))}
            {segments.map((segment) => (
              <path
                className="evaluation-line"
                key={segment.map((point) => point.positionIndex).join("-")}
                d={segment.map((point, index) => (
                  `${index === 0 ? "M" : "L"}${pointX(point.positionIndex, positionCount, compact)} ${pointY(point.value, compact)}`
                )).join(" ")}
              />
            ))}
            {selectedPoint ? (
              <line
                className="chart-selection-line"
                x1={pointX(selectedPoint.positionIndex, positionCount, compact)}
                x2={pointX(selectedPoint.positionIndex, positionCount, compact)}
                y1={chartTop(compact)}
                y2={HEIGHT - chartBottom(compact)}
              />
            ) : null}
          </svg>
          {[10, 0, -10].map((tick) => (
            <span
              aria-hidden="true"
              className="chart-axis-label"
              key={tick}
              style={{
                left: chartPercent(LEFT, WIDTH),
                top: chartPercent(pointY(tick, compact), HEIGHT),
              }}
            >
              {tick > 0 ? `+${tick}` : tick}
            </span>
          ))}
          {points.map((point) => {
            const rating = ratingByPosition.get(point.positionIndex);
            const selected = point.positionIndex === selectedPositionIndex;
            return (
              <button
                type="button"
                key={point.positionIndex}
                className="evaluation-point-target"
                data-position-index={point.positionIndex}
                data-chart-x={pointX(point.positionIndex, positionCount, compact)}
                data-chart-y={pointY(point.value, compact)}
                aria-current={selected ? "true" : undefined}
                aria-label={pointLabel(point.positionIndex, point.evaluation, moves, gameResult, t, rating)}
                style={{
                  left: chartPercent(pointX(point.positionIndex, positionCount, compact), WIDTH),
                  top: chartPercent(pointY(point.value, compact), HEIGHT),
                }}
                onClick={() => onSelectPosition(point.positionIndex)}
                onKeyDown={(event) => activate(event, point.positionIndex)}
              >
                {selected ? <span aria-hidden="true" className="chart-selection-ring" /> : null}
                <span
                  aria-hidden="true"
                  className={`evaluation-point ${rating ? `rating-${rating.classification}` : "chart-neutral"}${selected ? " selected-chart-point" : ""}`}
                >
                  {rating ? (
                    <RatingIcon
                      classification={rating.classification}
                      className={`chart-rating-glyph rating-tone-${rating.classification}`}
                      decorative
                    />
                  ) : null}
                </span>
              </button>
            );
          })}
        </div>
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
