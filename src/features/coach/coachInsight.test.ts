import { Chess } from "chess.js";
import { describe, expect, it } from "vitest";
import type { MoveClassification, PositionEvaluation } from "../../types";
import {
  buildCoachInsight,
  convertPrincipalVariation,
  formatMoverEvaluation,
  uciMoveToSan,
} from "./coachInsight";

function evaluation(
  positionIndex: number,
  scoreCp: number | null,
  bestMove: string | null,
  pv: string[] = [],
  mate: number | null = null,
): PositionEvaluation {
  const rankOne = { rank: 1 as const, scoreCp, mate, depth: 18, bestMove, pv };
  return { positionIndex, scoreCp, mate, depth: 18, bestMove, pv, variations: [rankOne] };
}

function rating(
  classification: MoveClassification["classification"],
  overrides: Partial<MoveClassification> = {},
): MoveClassification {
  return {
    moveIndex: 0,
    positionIndex: 1,
    color: "white",
    san: "e4",
    uci: "e2e4",
    classification,
    reason: classification === "notRated" ? "missingEvaluation" : "centipawnLoss",
    centipawnLoss: classification === "notRated" ? null : 20,
    ...overrides,
  };
}

function positionsFor(moves: string[], fen = new Chess().fen()): string[] {
  const chess = new Chess(fen);
  const positions = [chess.fen()];
  for (const move of moves) {
    chess.move(move);
    positions.push(chess.fen());
  }
  return positions;
}

describe("principal variation conversion", () => {
  it("converts a legal UCI line to at most six SAN plies", () => {
    const converted = convertPrincipalVariation(new Chess().fen(), [
      "e2e4", "e7e5", "g1f3", "b8c6", "f1b5", "a7a6", "b5a4",
    ]);
    expect(converted).toMatchObject({
      san: ["e4", "e5", "Nf3", "Nc6", "Bb5", "a6"],
      status: "available",
      firstMoveGivesCheck: false,
      firstMoveCaptures: false,
    });
  });

  it("handles castling, promotion, captures, and checks", () => {
    expect(uciMoveToSan("r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1", "e1g1"))
      .toBe("O-O");
    expect(uciMoveToSan("4k3/P7/8/8/8/8/8/4K3 w - - 0 1", "a7a8q"))
      .toBe("a8=Q+");
    expect(uciMoveToSan("7k/5Q2/6K1/8/8/8/8/8 w - - 0 1", "f7g7"))
      .toBe("Qg7#");

    const captureFen = positionsFor(["e4", "d5"])[2];
    expect(convertPrincipalVariation(captureFen, ["e4d5"]).firstMoveCaptures).toBe(true);
    expect(convertPrincipalVariation(
      "4k3/8/8/8/8/8/8/4R1K1 w - - 0 1",
      ["e1e7"],
    ).firstMoveGivesCheck).toBe(true);
  });

  it("makes missing and invalid saved lines explicit", () => {
    expect(convertPrincipalVariation(new Chess().fen(), [])).toMatchObject({ status: "missing", san: [] });
    expect(convertPrincipalVariation(new Chess().fen(), ["e2e5"])).toMatchObject({ status: "invalid", san: [] });
    expect(uciMoveToSan(new Chess().fen(), "bad")).toBeNull();
  });
});

describe("deterministic coach insight", () => {
  it("formats centipawn and mate evaluations from the mover's point of view", () => {
    expect(formatMoverEvaluation(evaluation(0, 125, null), rating("best"), "1-0")).toBe("+1.25");
    const black = rating("best", { color: "black", moveIndex: 1, positionIndex: 2 });
    expect(formatMoverEvaluation(evaluation(1, 125, null), black, "0-1")).toBe("-1.25");
    expect(formatMoverEvaluation(evaluation(1, null, null, [], -3), black, "0-1")).toBe("M3");
  });

  it.each([
    ["mistake", "forcingSafety"],
    ["miss", "forcingSafety"],
    ["blunder", "forcingSafety"],
    ["inaccuracy", "compareCandidates"],
    ["good", "compareCandidates"],
    ["brilliant", "repeatProcess"],
    ["great", "repeatProcess"],
    ["best", "repeatProcess"],
    ["excellent", "repeatProcess"],
  ] as const)("maps %s to the transparent %s tip family", (classification, tip) => {
    const game = { moves: ["e4"], positions: positionsFor(["e4"]), result: "1-0" };
    const insight = buildCoachInsight(game, rating(classification), [
      evaluation(0, 20, "e2e4", ["e2e4"]),
      evaluation(1, 0, null),
    ]);
    expect(insight.tip).toBe(tip);
  });

  it("prioritizes mate, then checking and capturing best lines", () => {
    const normalPositions = positionsFor(["e4"]);
    expect(buildCoachInsight(
      { moves: ["e4"], positions: normalPositions, result: "1-0" },
      rating("great", { reason: "greatMate" }),
      [evaluation(0, 0, "e2e4", ["e2e4"]), evaluation(1, null, null, [], 3)],
    ).tip).toBe("scanAllChecks");

    const checkFen = "4k3/8/8/8/8/8/8/4R1K1 w - - 0 1";
    const checkPositions = positionsFor(["Re7+"], checkFen);
    expect(buildCoachInsight(
      { moves: ["Re7+"], positions: checkPositions, result: "1-0" },
      rating("mistake", { san: "Re7+", uci: "e1e7" }),
      [evaluation(0, 0, "e1e7", ["e1e7"]), evaluation(1, -120, null)],
    ).tip).toBe("calculateChecks");

    const capturePositions = positionsFor(["e4", "d5"]);
    expect(buildCoachInsight(
      { moves: ["exd5"], positions: [capturePositions[2], positionsFor(["exd5"], capturePositions[2])[1]], result: "1-0" },
      rating("mistake", { san: "exd5", uci: "e4d5" }),
      [evaluation(0, 0, "e4d5", ["e4d5"]), evaluation(1, -120, null)],
    ).tip).toBe("compareCaptures");
  });

  it("is stable and keeps partial analysis explicitly unrated", () => {
    const game = { moves: ["e4"], positions: positionsFor(["e4"]), result: "1-0" };
    const inputRating = rating("notRated");
    const first = buildCoachInsight(game, inputRating, [evaluation(0, 0, "e2e4")]);
    const second = buildCoachInsight(game, inputRating, [evaluation(0, 0, "e2e4")]);
    expect(first).toEqual(second);
    expect(first).toMatchObject({ before: null, after: null, tip: "analyzeAdjacent" });
  });
});
