import { describe, expect, it } from "vitest";
import type { PositionEvaluation } from "../../types";
import { formatEvaluation } from "./engineClient";

function evaluation(scoreCp: number | null, mate: number | null, bestMove: string | null): PositionEvaluation {
  const pv: string[] = [];
  const rankOne = { rank: 1 as const, scoreCp, mate, depth: 18, bestMove, pv };
  return { positionIndex: 0, scoreCp, mate, depth: 18, bestMove, pv, variations: [rankOne] };
}

describe("formatEvaluation", () => {
  it("formats centipawns from White's perspective", () => {
    expect(formatEvaluation(evaluation(35, null, "e2e4"))).toBe("+0.35");
    expect(formatEvaluation(evaluation(-120, null, "e7e5"))).toBe("-1.20");
  });

  it("formats positive and negative mate scores", () => {
    expect(formatEvaluation(evaluation(null, 3, "h7h8q"))).toBe("M3");
    expect(formatEvaluation(evaluation(null, -3, "h7h8q"))).toBe("-M3");
  });

  it("formats a terminal mate score without requiring a best move", () => {
    expect(formatEvaluation(evaluation(null, 0, null))).toBe("M0");
  });
});
