import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { translate } from "../../i18n/translations";
import { MemoryGameRepository } from "../../lib/db/gameRepository";
import type { MoveClassification } from "../../types";
import type { CodexAdviceRequest, CodexAdviceResponse } from "../adviser/codexClient";
import { CoachPanel } from "./CoachPanel";
import type { CoachInsight } from "./coachInsight";

const rated: MoveClassification = {
  moveIndex: 1,
  positionIndex: 2,
  color: "black",
  san: "e5",
  uci: "e7e5",
  classification: "inaccuracy",
  reason: "centipawnLoss",
  centipawnLoss: 100,
};

const insight: CoachInsight = {
  rating: rated,
  before: "-0.50",
  after: "-1.50",
  bestMoveSan: "c5",
  principalVariationSan: ["c5", "Nf3"],
  lineStatus: "available",
  tip: "compareCandidates",
};

const codexRequest: CodexAdviceRequest = {
  language: "en",
  fenBefore: "start fen",
  fenAfter: "after fen",
  san: "e5",
  color: "black",
  result: "1-0",
  classification: "inaccuracy",
  reason: "centipawnLoss",
  centipawnLoss: 100,
  before: "-0.50",
  after: "-1.50",
  bestMoveSan: "c5",
  principalVariationSan: ["c5", "Nf3"],
};

const codexAnswer: CodexAdviceResponse = {
  schemaVersion: 1,
  advice: {
    summary: "The position stayed playable.",
    explanation: "The evaluation fell after e5.",
    plan: "Prepare c5.",
    practice: "Compare three candidate moves.",
  },
  model: "gpt-5.6-terra",
  reasoning: "medium",
  durationMs: 900,
};

describe("CoachPanel", () => {
  it("shows the factual rating, mover metrics, saved line, tip, and disclaimer", () => {
    render(<CoachPanel insight={insight} repository={new MemoryGameRepository()} codexAvailable={false} t={(key, variables) => translate("en", key, variables)} />);
    const panel = screen.getByRole("region", { name: "Coach" });
    expect(panel).toHaveTextContent("Inaccuracy");
    expect(screen.getByTestId("coach-rating-headline")).toHaveTextContent("Inaccuracy·-1.50");
    expect(screen.getByTestId("coach-rating-headline").querySelector('[data-rating-icon="inaccuracy"]')).toBeInTheDocument();
    expect(panel).toHaveTextContent("Played e5");
    expect(panel).toHaveTextContent("-0.50");
    expect(panel).toHaveTextContent("-1.50");
    expect(panel).toHaveTextContent("100 cp");
    expect(panel).toHaveTextContent("c5");
    expect(screen.getByLabelText("Stockfish principal variation")).toHaveTextContent("c5 Nf3");
    expect(panel).not.toHaveTextContent("Compare at least two candidate moves");
    fireEvent.click(screen.getByRole("tab", { name: "Plan & practice" }));
    expect(panel).toHaveTextContent("Compare at least two candidate moves");
    expect(panel).toHaveTextContent("not AI-generated or an official Chess.com explanation");
  });

  it("localizes the explicit unrated state in French", () => {
    render(<CoachPanel
      insight={{
        ...insight,
        rating: { ...rated, classification: "notRated", reason: "missingEvaluation", centipawnLoss: null },
        before: null,
        after: null,
        bestMoveSan: null,
        principalVariationSan: [],
        lineStatus: "missing",
        tip: "analyzeAdjacent",
      }}
      repository={new MemoryGameRepository()}
      codexAvailable={false}
      t={(key, variables) => translate("fr", key, variables)}
    />);
    const panel = screen.getByRole("region", { name: "Entraîneur" });
    expect(panel).toHaveTextContent("Non classé");
    fireEvent.click(screen.getByRole("tab", { name: "Plan et exercice" }));
    expect(panel).toHaveTextContent("Analysez les deux positions adjacentes");
    expect(panel).toHaveTextContent("ni généré par IA");
  });

  it("distinguishes selection, starting, loading, unavailable-engine, and unfinished states", () => {
    const repository = new MemoryGameRepository();
    const { rerender } = render(
      <CoachPanel insight={null} repository={repository} codexAvailable={false} t={(key, variables) => translate("en", key, variables)} />,
    );
    expect(screen.getByText("Select a move to see its coaching insight.")).toBeInTheDocument();
    rerender(
      <CoachPanel insight={null} emptyState="startingPosition" repository={repository} codexAvailable={false} t={(key, variables) => translate("en", key, variables)} />,
    );
    expect(screen.getByText("Choose a played move to start the review.")).toBeInTheDocument();
    rerender(
      <CoachPanel insight={null} emptyState="engineLoading" repository={repository} codexAvailable={false} t={(key, variables) => translate("en", key, variables)} />,
    );
    expect(screen.getByText("Looking for a local Stockfish engine.")).toBeInTheDocument();
    rerender(
      <CoachPanel insight={null} emptyState="analysisLoading" repository={repository} codexAvailable={false} t={(key, variables) => translate("en", key, variables)} />,
    );
    expect(screen.getByText("Stockfish is analyzing this game.")).toBeInTheDocument();
    rerender(
      <CoachPanel insight={null} emptyState="stockfishUnavailable" repository={repository} codexAvailable={false} t={(key, variables) => translate("en", key, variables)} />,
    );
    expect(screen.getByText("Stockfish is unavailable. Open Analysis settings to choose an engine.")).toBeInTheDocument();
    rerender(
      <CoachPanel insight={null} emptyState="unfinishedGame" repository={repository} codexAvailable={false} t={(key, variables) => translate("en", key, variables)} />,
    );
    expect(screen.getByText("Coach guidance is available only for completed games.")).toBeInTheDocument();
  });

  it("keeps the active tab while move changes clear stale Codex advice", async () => {
    const repository = new MemoryGameRepository();
    await repository.setSetting("codexAdvisorEnabled", "true");
    const requestAdvice = vi.fn().mockResolvedValue(codexAnswer);
    const t = (key: Parameters<typeof translate>[1], variables?: Record<string, string | number>) =>
      translate("en", key, variables);
    const { rerender } = render(
      <CoachPanel
        insight={insight}
        repository={repository}
        codexRequest={codexRequest}
        codexContextKey="move-2"
        codexAvailable
        requestAdvice={requestAdvice}
        t={t}
      />,
    );

    const explanationTab = screen.getByRole("tab", { name: "Explanation" });
    fireEvent.keyDown(explanationTab, { key: "ArrowRight" });
    const planTab = screen.getByRole("tab", { name: "Plan & practice" });
    expect(planTab).toHaveAttribute("aria-selected", "true");
    await waitFor(() => expect(planTab).toHaveFocus());
    fireEvent.click(await screen.findByRole("button", { name: "Ask Codex" }));
    expect(await screen.findByText("Prepare c5.")).toBeInTheDocument();
    expect(screen.getByText("Compare three candidate moves.")).toBeInTheDocument();
    expect(screen.queryByText("The position stayed playable.")).not.toBeInTheDocument();

    rerender(
      <CoachPanel
        insight={null}
        repository={repository}
        codexRequest={null}
        codexContextKey="move-3"
        codexAvailable
        requestAdvice={requestAdvice}
        t={t}
      />,
    );
    expect(screen.getByRole("tab", { name: "Plan & practice" })).toHaveAttribute("aria-selected", "true");
    expect(screen.queryByText("Prepare c5.")).not.toBeInTheDocument();
    expect(screen.getByText(/Select a fully analyzed/)).toBeInTheDocument();
  });
});
