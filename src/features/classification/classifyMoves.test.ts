import { Chess } from "chess.js";
import { describe, expect, it } from "vitest";
import type { PositionEvaluation } from "../../types";
import {
  calculateGameAccuracy,
  classifyFromFacts,
  classifyGameMoves,
  evaluationToWhiteCentipawns,
  formatCentipawnLoss,
  moveToUci,
  playedMoveFromSan,
  type ClassificationFacts,
} from "./classifyMoves";

const neutralFacts: ClassificationFacts = {
  centipawnLoss: 0,
  isBestMove: false,
  isSoundSacrifice: false,
  foundMate: false,
  recoveredPosition: false,
  missedWin: false,
};

function evaluation(
  positionIndex: number,
  scoreCp: number | null,
  bestMove: string | null,
  mate: number | null = null,
): PositionEvaluation {
  const rankOne = { rank: 1 as const, scoreCp, mate, depth: 18, bestMove, pv: [] };
  return { positionIndex, scoreCp, mate, depth: 18, bestMove, pv: [], variations: [rankOne] };
}

function positionsFor(moves: string[]): string[] {
  const chess = new Chess();
  const positions = [chess.fen()];
  for (const move of moves) {
    chess.move(move);
    positions.push(chess.fen());
  }
  return positions;
}

describe("classifyFromFacts", () => {
  it.each([
    [0, "excellent"],
    [15, "excellent"],
    [16, "good"],
    [50, "good"],
    [51, "inaccuracy"],
    [100, "inaccuracy"],
    [101, "mistake"],
    [200, "mistake"],
    [201, "blunder"],
  ] as const)("classifies %i cp loss as %s", (centipawnLoss, classification) => {
    expect(classifyFromFacts({ ...neutralFacts, centipawnLoss }).classification).toBe(classification);
  });

  it("applies Brilliant, Great, Best, and Miss priorities in contract order", () => {
    expect(classifyFromFacts({
      ...neutralFacts,
      centipawnLoss: 15,
      isBestMove: true,
      isSoundSacrifice: true,
      foundMate: true,
    }).classification).toBe("brilliant");
    expect(classifyFromFacts({ ...neutralFacts, isBestMove: true, foundMate: true }).classification).toBe("great");
    expect(classifyFromFacts({ ...neutralFacts, isBestMove: true, recoveredPosition: true }).classification).toBe("great");
    expect(classifyFromFacts({ ...neutralFacts, isBestMove: true }).classification).toBe("best");
    expect(classifyFromFacts({ ...neutralFacts, centipawnLoss: 300, missedWin: true }).classification).toBe("miss");
  });
});

describe("move reconstruction and evaluation", () => {
  it("reconstructs castling and promotion UCI moves", () => {
    const castle = playedMoveFromSan("r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1", "O-O");
    const promotion = playedMoveFromSan("4k3/P7/8/8/8/8/8/4K3 w - - 0 1", "a8=Q+");
    expect(castle && moveToUci(castle)).toBe("e1g1");
    expect(promotion && moveToUci(promotion)).toBe("a7a8q");
    expect(playedMoveFromSan(new Chess().fen(), "not-a-move")).toBeNull();
  });

  it("maps mate values, including terminal mate zero, to decisive White scores", () => {
    expect(evaluationToWhiteCentipawns(evaluation(0, null, null, 3), "1-0")).toBe(99_700);
    expect(evaluationToWhiteCentipawns(evaluation(0, null, null, -3), "0-1")).toBe(-99_700);
    expect(evaluationToWhiteCentipawns(evaluation(0, null, null, 0), "1-0")).toBe(100_000);
    expect(evaluationToWhiteCentipawns(evaluation(0, null, null, 0), "1/2-1/2")).toBe(0);
  });
});

describe("classifyGameMoves", () => {
  it("computes centipawn loss from each mover's perspective", () => {
    const moves = ["e4", "e5"];
    const ratings = classifyGameMoves(
      { moves, positions: positionsFor(moves), result: "1-0" },
      [
        evaluation(0, 100, "d2d4"),
        evaluation(1, 50, "c7c5"),
        evaluation(2, 150, "g1f3"),
      ],
    );
    expect(ratings[0]).toMatchObject({ color: "white", centipawnLoss: 50, classification: "good" });
    expect(ratings[1]).toMatchObject({ color: "black", centipawnLoss: 100, classification: "inaccuracy" });
  });

  it("marks a sound best material offer Brilliant and rejects an unsound one", () => {
    const beforeFen = "4k3/8/8/1p6/8/8/8/3QK3 w - - 0 1";
    const chess = new Chess(beforeFen);
    chess.move("Qa4");
    const game = { moves: ["Qa4"], positions: [beforeFen, chess.fen()], result: "1-0" };

    expect(classifyGameMoves(game, [
      evaluation(0, 0, "d1a4"),
      evaluation(1, 0, null),
    ])[0].classification).toBe("brilliant");
    expect(classifyGameMoves(game, [
      evaluation(0, 0, "d1a4"),
      evaluation(1, -100, null),
    ])[0].classification).toBe("best");
  });

  it("returns explicit unrated reasons for partial caches and invalid SAN", () => {
    const start = new Chess().fen();
    expect(classifyGameMoves(
      { moves: ["e4"], positions: [start, positionsFor(["e4"])[1]], result: "1-0" },
      [evaluation(0, 0, "e2e4")],
    )[0]).toMatchObject({ classification: "notRated", reason: "missingEvaluation" });
    expect(classifyGameMoves(
      { moves: ["bad"], positions: [start, start], result: "1-0" },
      [evaluation(0, 0, null), evaluation(1, 0, null)],
    )[0]).toMatchObject({ classification: "notRated", reason: "invalidMove" });
  });
});

describe("ChessMate Accuracy", () => {
  it("averages the documented exponential move score by color", () => {
    const ratings = [
      { moveIndex: 0, positionIndex: 1, color: "white", san: "e4", uci: "e2e4", classification: "best", reason: "engineBest", centipawnLoss: 0 },
      { moveIndex: 2, positionIndex: 3, color: "white", san: "Nf3", uci: "g1f3", classification: "mistake", reason: "centipawnLoss", centipawnLoss: 120 },
      { moveIndex: 1, positionIndex: 2, color: "black", san: "e5", uci: null, classification: "notRated", reason: "missingEvaluation", centipawnLoss: null },
    ] as const;
    expect(calculateGameAccuracy([...ratings])).toEqual({ white: 68.4, black: null });
  });

  it("caps displayed losses while keeping the underlying value", () => {
    expect(formatCentipawnLoss(999)).toBe("999 cp");
    expect(formatCentipawnLoss(1_000)).toBe("999+ cp");
    expect(formatCentipawnLoss(null)).toBe("—");
  });
});
