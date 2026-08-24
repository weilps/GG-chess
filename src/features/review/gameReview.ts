import type {
  MoveClassification,
  MoveClassificationId,
  PositionEvaluation,
} from "../../types";
import { evaluationToWhiteCentipawns } from "../classification/classifyMoves";

export const GRAPH_LIMIT_CP = 1_000;
export const SUMMARY_CLASSIFICATIONS: Exclude<MoveClassificationId, "notRated">[] = [
  "brilliant",
  "great",
  "best",
  "excellent",
  "good",
  "inaccuracy",
  "mistake",
  "miss",
  "blunder",
];

export interface EvaluationChartPoint {
  positionIndex: number;
  value: number;
  evaluation: PositionEvaluation;
}

export type EvaluationChartSegment = EvaluationChartPoint[];
export type ClassificationCounts = Record<MoveClassificationId, number>;

export function evaluationGraphValue(
  evaluation: PositionEvaluation,
  gameResult: string,
): number {
  const whiteCp = evaluationToWhiteCentipawns(evaluation, gameResult);
  return Math.max(-GRAPH_LIMIT_CP, Math.min(GRAPH_LIMIT_CP, whiteCp)) / 100;
}

export function whiteEvaluationShare(
  evaluation: PositionEvaluation | null,
  gameResult: string,
): number | null {
  if (!evaluation) return null;
  const whiteCp = evaluationToWhiteCentipawns(evaluation, gameResult);
  if (evaluation.mate !== null) {
    if (whiteCp > 0) return 100;
    if (whiteCp < 0) return 0;
    return 50;
  }
  return 100 / (1 + Math.exp(-whiteCp / 400));
}

export function buildEvaluationSegments(
  evaluations: PositionEvaluation[],
  positionCount: number,
  gameResult: string,
): EvaluationChartSegment[] {
  const byPosition = new Map(evaluations.map((evaluation) => [evaluation.positionIndex, evaluation]));
  const segments: EvaluationChartSegment[] = [];
  let current: EvaluationChartSegment = [];

  for (let positionIndex = 0; positionIndex < positionCount; positionIndex += 1) {
    const evaluation = byPosition.get(positionIndex);
    if (!evaluation) {
      if (current.length > 0) segments.push(current);
      current = [];
      continue;
    }
    current.push({
      positionIndex,
      value: evaluationGraphValue(evaluation, gameResult),
      evaluation,
    });
  }
  if (current.length > 0) segments.push(current);
  return segments;
}

function emptyCounts(): ClassificationCounts {
  return {
    brilliant: 0,
    great: 0,
    best: 0,
    excellent: 0,
    good: 0,
    inaccuracy: 0,
    mistake: 0,
    miss: 0,
    blunder: 0,
    notRated: 0,
  };
}

export function countClassifications(ratings: MoveClassification[]): {
  white: ClassificationCounts;
  black: ClassificationCounts;
} {
  const counts = { white: emptyCounts(), black: emptyCounts() };
  for (const rating of ratings) counts[rating.color][rating.classification] += 1;
  return counts;
}

const CRITICAL_CLASSIFICATIONS = new Set<MoveClassificationId>([
  "inaccuracy",
  "mistake",
  "miss",
  "blunder",
]);

export function findCriticalMoments(
  ratings: MoveClassification[],
  limit = 5,
): MoveClassification[] {
  return ratings
    .filter((rating) => (
      rating.centipawnLoss !== null
      && CRITICAL_CLASSIFICATIONS.has(rating.classification)
    ))
    .sort((left, right) => (
      (right.centipawnLoss ?? 0) - (left.centipawnLoss ?? 0)
      || left.moveIndex - right.moveIndex
    ))
    .slice(0, limit);
}

export function formatWhiteEvaluation(
  evaluation: PositionEvaluation,
  gameResult: string,
): string {
  if (evaluation.mate !== null) {
    const whiteCp = evaluationToWhiteCentipawns(evaluation, gameResult);
    if (whiteCp === 0) return "M0";
    return `${whiteCp < 0 ? "-" : ""}M${Math.abs(evaluation.mate)}`;
  }
  const pawns = (evaluation.scoreCp ?? 0) / 100;
  return `${pawns >= 0 ? "+" : ""}${pawns.toFixed(2)}`;
}
