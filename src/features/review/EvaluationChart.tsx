import type { KeyboardEvent } from "react";
import type { TranslationKey } from "../../i18n/translations";
import type { MoveClassification, PositionEvaluation } from "../../types";
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
): string {
  const formatted = formatWhiteEvaluation(evaluation, gameResult);
  if (positionIndex === 0) return t("chartStartingPosition", { evaluation: formatted });
  return t("chartMovePosition", {
    position: positionIndex,
    move: moves[positionIndex - 1] ?? "—",
    evaluation: formatted,
  });
}

export function EvaluationChart({
  evaluations,
  ratings,
  moves,
  gameResult,
  selectedPositionIndex,
  onSelectPosition,
  t,
}: {
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
  const activate = (event: KeyboardEvent<SVGCircleElement>, positionIndex: number) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      onSelectPosition(positionIndex);
    }
  };

  return (
    <section className="evaluation-chart-card" aria-label={t("evaluationGraph")}>
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
          {points.map((point) => {
            const rating = ratingByPosition.get(point.positionIndex);
            const selected = point.positionIndex === selectedPositionIndex;
            return (
              <circle
                key={point.positionIndex}
                className={`evaluation-point ${rating ? `rating-${rating.classification}` : "chart-neutral"}${selected ? " selected-chart-point" : ""}`}
                cx={pointX(point.positionIndex, positionCount)}
                cy={pointY(point.value)}
                r={selected ? 6 : 4}
                role="button"
                tabIndex={0}
                aria-current={selected ? "true" : undefined}
                aria-label={pointLabel(point.positionIndex, point.evaluation, moves, gameResult, t)}
                onClick={() => onSelectPosition(point.positionIndex)}
                onKeyDown={(event) => activate(event, point.positionIndex)}
              />
            );
          })}
        </svg>
      )}
      <div className="chart-legend" aria-label={t("chartLegend")}>
        {SUMMARY_CLASSIFICATIONS.map((classification) => (
          <span key={classification}>
            <i className={`rating-${classification}`} aria-hidden="true" />
            {ratingLabel(classification, t)}
          </span>
        ))}
      </div>
    </section>
  );
}
