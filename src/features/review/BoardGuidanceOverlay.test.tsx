import { render, screen } from "@testing-library/react";
import { Chess } from "chess.js";
import { describe, expect, it } from "vitest";
import { translate } from "../../i18n/translations";
import type { MoveClassification, PositionEvaluation, RankedVariation, StoredGame } from "../../types";
import {
  BoardGuidanceOverlay,
} from "./BoardGuidanceOverlay";
import {
  buildBoardGuidance,
  squareCenter,
} from "./boardGuidance";

function reviewedGame(): StoredGame {
  const chess = new Chess();
  const positions = [chess.fen()];
  const moves = ["e4", "e5", "Nf3"];
  for (const move of moves) {
    chess.move(move);
    positions.push(chess.fen());
  }
  return {
    fingerprint: "guidance-game",
    white: "Ada",
    black: "Grace",
    result: "1-0",
    playedAt: null,
    displayDate: null,
    timeControl: null,
    source: null,
    rawPgn: "",
    moves,
    positions,
    importedAt: "2026-08-30T00:00:00Z",
  };
}

function variation(rank: 1 | 2 | 3, bestMove: string, scoreCp: number): RankedVariation {
  return { rank, scoreCp, mate: null, depth: 18, bestMove, pv: [bestMove] };
}

function evaluation(positionIndex: number, variations: RankedVariation[]): PositionEvaluation {
  return { positionIndex, ...variations[0], variations };
}

function rating(positionIndex: number, classification: MoveClassification["classification"]): MoveClassification {
  return {
    moveIndex: positionIndex - 1,
    positionIndex,
    color: positionIndex % 2 === 1 ? "white" : "black",
    san: reviewedGame().moves[positionIndex - 1],
    uci: null,
    classification,
    reason: "centipawnLoss",
    centipawnLoss: 120,
  };
}

const t = (key: Parameters<typeof translate>[1], variables?: Record<string, string | number>) =>
  translate("en", key, variables);

describe("board guidance", () => {
  it("keeps the starting position free of arrows", () => {
    const game = reviewedGame();
    expect(buildBoardGuidance({
      enabled: true,
      engineStatus: "ready",
      evaluations: [evaluation(0, [variation(1, "e2e4", 25)])],
      game,
      loading: false,
      mode: "next",
      multiPv: 1,
      positionIndex: 0,
      selectedRating: null,
    }).arrows).toEqual([]);
  });

  it("shows every requested next-move line plus an orange played warning", () => {
    const game = reviewedGame();
    const plan = buildBoardGuidance({
      enabled: true,
      engineStatus: "ready",
      evaluations: [evaluation(1, [
        variation(1, "c7c5", -90),
        variation(2, "e7e5", -55),
        variation(3, "g8f6", -20),
      ])],
      game,
      loading: false,
      mode: "next",
      multiPv: 3,
      positionIndex: 1,
      selectedRating: rating(1, "mistake"),
    });

    expect(plan.boardPositionIndex).toBe(1);
    expect(plan.arrows).toMatchObject([
      { rank: 1, sourceSquare: "c7", targetSquare: "c5", evaluation: "-0.90", classification: "best" },
      { rank: 2, sourceSquare: "e7", targetSquare: "e5", evaluation: "-0.55", classification: "good" },
      { rank: 3, sourceSquare: "g8", targetSquare: "f6", evaluation: "-0.20", classification: "inaccuracy" },
      { rank: null, sourceSquare: "e2", targetSquare: "e4", tone: "warning", warningSymbol: "!", evaluation: "-0.90" },
    ]);
  });

  it("uses the pre-move position in compare mode and merges a duplicate played blunder", () => {
    const game = reviewedGame();
    const plan = buildBoardGuidance({
      enabled: true,
      engineStatus: "ready",
      evaluations: [
        evaluation(1, [
          variation(1, "c7c5", -90),
          variation(2, "e7e5", -55),
        ]),
        evaluation(2, [variation(1, "g1f3", 25)]),
      ],
      game,
      loading: false,
      mode: "compare",
      multiPv: 2,
      positionIndex: 2,
      selectedRating: rating(2, "blunder"),
    });

    expect(plan.boardPositionIndex).toBe(1);
    expect(plan.arrows).toHaveLength(2);
    expect(plan.arrows[1]).toMatchObject({
      rank: 2,
      sourceSquare: "e7",
      targetSquare: "e5",
      played: true,
      tone: "blunder",
      warningSymbol: "!!",
      evaluation: "+0.25",
      classification: "blunder",
    });
  });

  it.each([
    { name: "disabled", enabled: false, loading: false, status: "ready" as const, count: 1 as const, variations: [variation(1, "c7c5", 90)] },
    { name: "loading", enabled: true, loading: true, status: "ready" as const, count: 1 as const, variations: [variation(1, "c7c5", 90)] },
    { name: "engine error", enabled: true, loading: false, status: "error" as const, count: 1 as const, variations: [variation(1, "c7c5", 90)] },
    { name: "incomplete MultiPV", enabled: true, loading: false, status: "ready" as const, count: 2 as const, variations: [variation(1, "c7c5", 90)] },
    { name: "terminal", enabled: true, loading: false, status: "ready" as const, count: 1 as const, variations: [variation(1, "", 0)] },
  ])("shows no stale arrows when $name", ({ enabled, loading, status, count, variations }) => {
    const game = reviewedGame();
    const plan = buildBoardGuidance({
      enabled,
      engineStatus: status,
      evaluations: [evaluation(1, variations)],
      game,
      loading,
      mode: "next",
      multiPv: count,
      positionIndex: 1,
      selectedRating: rating(1, "good"),
    });
    expect(plan.arrows).toEqual([]);
  });

  it("mirrors geometry after Flip and exposes cyan hierarchy, integrated heads, badges, and accessible detail", () => {
    expect(squareCenter("a1", "white")).toEqual({ x: 50, y: 750 });
    expect(squareCenter("a1", "black")).toEqual({ x: 750, y: 50 });
    const arrows = [
      { key: "one", sourceSquare: "a1", targetSquare: "a8", tone: "ranked" as const, rank: 1 as const, evaluation: "+1.95", played: false, warningSymbol: null, classification: "best" as const, classificationReason: "engineBest" as const, centipawnLoss: 0 },
      { key: "two", sourceSquare: "b1", targetSquare: "a8", tone: "ranked" as const, rank: 2 as const, evaluation: "+1.20", played: false, warningSymbol: null, classification: "good" as const, classificationReason: "centipawnLoss" as const, centipawnLoss: 75 },
    ];
    render(<BoardGuidanceOverlay arrows={arrows} orientation="black" t={t} />);

    const rankOne = screen.getByTestId("guidance-arrow-1");
    const rankTwo = screen.getByTestId("guidance-arrow-2");
    expect(rankOne).toHaveAttribute("stroke", "var(--guidance-candidate)");
    expect(rankTwo).toHaveAttribute("stroke", "var(--guidance-candidate)");
    expect(rankOne).toHaveAttribute("stroke-width", "16");
    expect(rankTwo).toHaveAttribute("stroke-width", "12");
    expect(rankOne).toHaveAttribute("stroke-opacity", "0.96");
    expect(rankTwo).toHaveAttribute("stroke-opacity", "0.76");
    expect(rankOne).toHaveAttribute("data-head-visible", "true");
    expect(rankOne.getAttribute("marker-end")).toMatch(/^url\(#.+-arrow-0\)$/);
    const badge = screen.getByTestId("guidance-label-1");
    expect(badge).toHaveClass("rating-best");
    expect(badge).toHaveAttribute("data-corner", "bottom-right");
    expect(badge.querySelectorAll("circle")).toHaveLength(2);
    expect(badge.querySelector(".guidance-rating-icon")).not.toBeNull();
    expect(badge).toHaveTextContent("+1.95");
    expect(screen.getByRole("img", { name: "Stockfish guidance arrows" })).toHaveAccessibleDescription(
      /Candidate rank 1: Best, White evaluation \+1\.95, from a1 to a8\./,
    );
  });

  it.each(["white", "black"] as const)(
    "keeps four shared edge-destination badges in deterministic square corners when oriented %s",
    (orientation) => {
      const arrows = [
        { key: "one", sourceSquare: "a1", targetSquare: "a8", tone: "ranked" as const, rank: 1 as const, evaluation: "+1.95", played: false, warningSymbol: null, classification: "best" as const, classificationReason: "engineBest" as const, centipawnLoss: 0 },
        { key: "two", sourceSquare: "b1", targetSquare: "a8", tone: "ranked" as const, rank: 2 as const, evaluation: "+1.20", played: false, warningSymbol: null, classification: "good" as const, classificationReason: "centipawnLoss" as const, centipawnLoss: 75 },
        { key: "three", sourceSquare: "c1", targetSquare: "a8", tone: "ranked" as const, rank: 3 as const, evaluation: "+0.80", played: false, warningSymbol: null, classification: "mistake" as const, classificationReason: "centipawnLoss" as const, centipawnLoss: 115 },
        { key: "played", sourceSquare: "d1", targetSquare: "a8", tone: "blunder" as const, rank: null, evaluation: "+0.10", played: true, warningSymbol: "!!" as const, classification: "blunder" as const, classificationReason: "centipawnLoss" as const, centipawnLoss: 300 },
      ];
      render(<BoardGuidanceOverlay arrows={arrows} orientation={orientation} t={t} />);

      const badges = [
        screen.getByTestId("guidance-label-1"),
        screen.getByTestId("guidance-label-2"),
        screen.getByTestId("guidance-label-3"),
        screen.getByTestId("guidance-label-played"),
      ];
      const corners = badges.map((badge) => badge.getAttribute("data-corner"));
      expect(new Set(corners).size).toBe(4);
      expect(corners[0]).toBe(orientation === "white" ? "top-right" : "bottom-right");
      expect(new Set(badges.map((badge) => badge.getAttribute("transform"))).size).toBe(4);
      for (const badge of badges) {
        expect(Number(badge.getAttribute("data-label-x"))).toBeGreaterThanOrEqual(0);
        expect(Number(badge.getAttribute("data-label-x"))).toBeLessThanOrEqual(800);
        expect(Number(badge.getAttribute("data-label-y"))).toBeGreaterThanOrEqual(0);
        expect(Number(badge.getAttribute("data-label-y"))).toBeLessThanOrEqual(800);
      }
    },
  );

  it("uses amber and red warning arrows with rating icons and French accessible text", () => {
    const arrows = [
      { key: "warning", sourceSquare: "e2", targetSquare: "e4", tone: "warning" as const, rank: null, evaluation: "+0.40", played: true, warningSymbol: "!" as const, classification: "mistake" as const, classificationReason: "centipawnLoss" as const, centipawnLoss: 140 },
      { key: "blunder", sourceSquare: "d7", targetSquare: "d5", tone: "blunder" as const, rank: null, evaluation: "-2.10", played: true, warningSymbol: "!!" as const, classification: "blunder" as const, classificationReason: "centipawnLoss" as const, centipawnLoss: 310 },
    ];
    render(<BoardGuidanceOverlay
      arrows={arrows}
      orientation="white"
      t={(key, variables) => translate("fr", key, variables)}
    />);

    expect(screen.getAllByTestId("guidance-arrow-played")[0]).toHaveAttribute("stroke", "var(--guidance-warning)");
    expect(screen.getAllByTestId("guidance-arrow-played")[1]).toHaveAttribute("stroke", "var(--guidance-blunder)");
    expect(screen.getByRole("img", { name: "Flèches de guidage Stockfish" })).toHaveAccessibleDescription(
      /Erreur, évaluation des Blancs \+0\.40.*Gaffe, évaluation des Blancs -2\.10/,
    );
  });
});
