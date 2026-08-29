import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { Chess } from "chess.js";
import { describe, expect, it, vi } from "vitest";
import { translate } from "../../i18n/translations";
import { MemoryGameRepository } from "../../lib/db/gameRepository";
import type { AnalysisSnapshot, StoredGame } from "../../types";
import type { CodexAdviceRequest } from "../adviser/codexClient";
import { ReviewScreen } from "./ReviewScreen";

vi.mock("react-chessboard", () => ({
  Chessboard: ({ options }: { options: { position: string } }) => (
    <div data-testid="chessboard-position">{options.position}</div>
  ),
}));

vi.mock("../adviser/CodexAdvisorPanel", () => ({
  CodexAdvisorPanel: ({ request }: { request: CodexAdviceRequest | null }) => (
    <div data-testid="codex-adviser-request">
      {request ? `${request.san}:${request.classification}` : "unavailable"}
    </div>
  ),
}));

vi.mock("../engine/EnginePanel", async () => {
  const { useEffect } = await import("react");
  const evaluation = (positionIndex: number, scoreCp: number, bestMove: string | null, pv: string[]) => ({
    positionIndex,
    scoreCp,
    mate: null,
    depth: 18,
    bestMove,
    pv,
    variations: [{ rank: 1 as const, scoreCp, mate: null, depth: 18, bestMove, pv }],
  });
  const snapshot: AnalysisSnapshot = {
    cacheKey: "review\u0000Stockfish 18\u000018\u0000balanced",
    profile: "balanced",
    engineStatus: "ready",
    loading: false,
    multiPv: 1,
    guidanceEnabled: true,
    guidanceMode: "next",
    evaluations: [
      evaluation(0, 100, "e2e4", ["e2e4", "e7e5"]),
      evaluation(1, 50, "c7c5", ["c7c5", "g1f3"]),
      evaluation(2, 150, null, []),
    ],
  };
  return {
    EnginePanel: ({ onAnalysisStateChange }: {
      onAnalysisStateChange?: (next: AnalysisSnapshot) => void;
    }) => {
      useEffect(() => onAnalysisStateChange?.(snapshot), [onAnalysisStateChange]);
      return (
        <>
          <button onClick={() => onAnalysisStateChange?.({ ...snapshot, guidanceMode: "compare" })}>
            Compare fixture
          </button>
          <button onClick={() => onAnalysisStateChange?.({
            cacheKey: null,
            profile: "deep",
            engineStatus: "ready",
            loading: true,
            multiPv: 1,
            guidanceEnabled: true,
            guidanceMode: "next",
            evaluations: [],
          })}>
            Switch profile fixture
          </button>
        </>
      );
    },
  };
});

function reviewedGame(): StoredGame {
  const chess = new Chess();
  const positions = [chess.fen()];
  chess.move("e4");
  positions.push(chess.fen());
  chess.move("e5");
  positions.push(chess.fen());
  return {
    fingerprint: "game-review-integration",
    white: "Ada",
    black: "Grace",
    result: "1-0",
    playedAt: null,
    displayDate: null,
    timeControl: null,
    source: null,
    rawPgn: "",
    moves: ["e4", "e5"],
    positions,
    importedAt: "2026-08-24T00:00:00Z",
  };
}

describe("ReviewScreen Game Review integration", () => {
  it("keeps graph, critical moments, board, and active cache synchronized", async () => {
    const game = reviewedGame();
    render(
      <ReviewScreen
        game={game}
        repository={new MemoryGameRepository()}
        language="en"
        onBack={vi.fn()}
        t={(key, variables) => translate("en", key, variables)}
      />,
    );

    const firstMovePoint = await screen.findByRole("button", {
      name: "Position 1, after e4, evaluation +0.50",
    });
    fireEvent.click(firstMovePoint);
    expect(screen.getByTestId("chessboard-position")).toHaveTextContent(game.positions[1]);
    expect(screen.getByTestId("guidance-arrow-1")).toHaveAttribute("data-source", "c7");

    fireEvent.click(screen.getByRole("tab", { name: "Summary" }));
    fireEvent.click(screen.getByRole("button", {
      name: "Black, move 1 e5, Inaccuracy, 100 cp",
    }));
    expect(screen.getByTestId("chessboard-position")).toHaveTextContent(game.positions[2]);
    const coach = screen.getByRole("region", { name: "Coach" });
    expect(coach).toHaveTextContent("Inaccuracy");
    expect(coach).toHaveTextContent("Played e5");
    expect(coach).toHaveTextContent("c5 Nf3");
    expect(screen.getByTestId("codex-adviser-request")).toHaveTextContent("e5:inaccuracy");

    fireEvent.click(screen.getByRole("button", { name: "Compare fixture" }));
    expect(screen.getByTestId("chessboard-position")).toHaveTextContent(game.positions[1]);
    expect(screen.getByTestId("position-status")).toHaveTextContent("position before the move");
    expect(screen.getByTestId("guidance-arrow-played")).toHaveAttribute("data-tone", "warning");

    fireEvent.click(screen.getByRole("button", { name: "Switch profile fixture" }));
    await waitFor(() => expect(screen.getByText("Analyze positions to reveal the course of the game.")).toBeInTheDocument());
    expect(screen.queryByRole("button", { name: /Position 1, after e4/ })).not.toBeInTheDocument();
    expect(screen.getByRole("meter", { name: "Evaluation bar unavailable for this position" }))
      .not.toHaveAttribute("aria-valuenow");
    expect(coach).toHaveTextContent("Stockfish is analyzing this game.");
    expect(coach).not.toHaveTextContent("c5 Nf3");
    expect(screen.getByTestId("codex-adviser-request")).toHaveTextContent("unavailable");
  });
});
