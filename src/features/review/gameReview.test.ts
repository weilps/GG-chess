import { describe, expect, it } from "vitest";
import type {
  MoveClassification,
  MoveClassificationId,
  PositionEvaluation,
} from "../../types";
import {
  buildEvaluationSegments,
  countClassifications,
  evaluationGraphValue,
  findCriticalMoments,
  formatWhiteEvaluation,
  whiteEvaluationShare,
} from "./gameReview";

function evaluation(
  positionIndex: number,
  scoreCp: number | null,
  mate: number | null = null,
): PositionEvaluation {
  return { positionIndex, scoreCp, mate, depth: 18, bestMove: null, pv: [] };
}

function rating(
  moveIndex: number,
  color: "white" | "black",
  classification: MoveClassificationId,
  centipawnLoss: number | null,
): MoveClassification {
  return {
    moveIndex,
    positionIndex: moveIndex + 1,
    color,
    san: `move-${moveIndex}`,
    uci: null,
    classification,
    reason: centipawnLoss === null ? "missingEvaluation" : "centipawnLoss",
    centipawnLoss,
  };
}

describe("Game Review evaluation transforms", () => {
  it("clamps centipawns and maps signed mate scores to graph bounds", () => {
    expect(evaluationGraphValue(evaluation(0, 2_500), "1-0")).toBe(10);
    expect(evaluationGraphValue(evaluation(0, -2_500), "0-1")).toBe(-10);
    expect(evaluationGraphValue(evaluation(0, null, 3), "1-0")).toBe(10);
    expect(evaluationGraphValue(evaluation(0, null, -3), "0-1")).toBe(-10);
    expect(formatWhiteEvaluation(evaluation(0, null, -3), "0-1")).toBe("-M3");
  });

  it("uses the documented logistic White share and decisive mate values", () => {
    expect(whiteEvaluationShare(null, "1-0")).toBeNull();
    expect(whiteEvaluationShare(evaluation(0, 0), "1-0")).toBe(50);
    expect(whiteEvaluationShare(evaluation(0, 400), "1-0")).toBeCloseTo(73.106, 3);
    expect(whiteEvaluationShare(evaluation(0, null, 2), "1-0")).toBe(100);
    expect(whiteEvaluationShare(evaluation(0, null, -2), "0-1")).toBe(0);
  });

  it("breaks partial caches instead of connecting across missing positions", () => {
    const segments = buildEvaluationSegments([
      evaluation(0, 0),
      evaluation(1, 20),
      evaluation(3, -40),
    ], 5, "1-0");
    expect(segments.map((segment) => segment.map((point) => point.positionIndex))).toEqual([
      [0, 1],
      [3],
    ]);
  });
});

describe("Game Review summaries", () => {
  it("counts every classification independently by color", () => {
    const counts = countClassifications([
      rating(0, "white", "best", 0),
      rating(1, "black", "blunder", 300),
      rating(2, "white", "notRated", null),
    ]);
    expect(counts.white.best).toBe(1);
    expect(counts.white.notRated).toBe(1);
    expect(counts.black.blunder).toBe(1);
    expect(counts.black.notRated).toBe(0);
  });

  it("selects only critical ratings, orders by CPL then move, and limits to five", () => {
    const moments = findCriticalMoments([
      rating(0, "white", "mistake", 120),
      rating(1, "black", "good", 40),
      rating(2, "white", "blunder", 400),
      rating(3, "black", "miss", 300),
      rating(4, "white", "inaccuracy", 100),
      rating(5, "black", "mistake", 120),
      rating(6, "white", "blunder", 500),
      rating(7, "black", "notRated", null),
    ]);
    expect(moments.map((moment) => moment.moveIndex)).toEqual([6, 2, 3, 0, 5]);
  });
});
