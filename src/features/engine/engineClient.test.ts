import { describe, expect, it } from "vitest";
import { formatEvaluation } from "./engineClient";

describe("formatEvaluation", () => {
  it("formats centipawns from White's perspective", () => {
    expect(formatEvaluation({
      positionIndex: 0,
      scoreCp: 35,
      mate: null,
      depth: 18,
      bestMove: "e2e4",
      pv: [],
    })).toBe("+0.35");
    expect(formatEvaluation({
      positionIndex: 1,
      scoreCp: -120,
      mate: null,
      depth: 18,
      bestMove: "e7e5",
      pv: [],
    })).toBe("-1.20");
  });

  it("formats positive and negative mate scores", () => {
    const evaluation = {
      positionIndex: 0,
      scoreCp: null,
      depth: 22,
      bestMove: "h7h8q",
      pv: [],
    };
    expect(formatEvaluation({ ...evaluation, mate: 3 })).toBe("M3");
    expect(formatEvaluation({ ...evaluation, mate: -3 })).toBe("-M3");
  });

  it("formats a terminal mate score without requiring a best move", () => {
    expect(formatEvaluation({
      positionIndex: 42,
      scoreCp: null,
      mate: 0,
      depth: 0,
      bestMove: null,
      pv: [],
    })).toBe("M0");
  });
});
