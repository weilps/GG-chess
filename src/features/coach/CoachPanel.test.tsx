import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { translate } from "../../i18n/translations";
import type { CodexAdviceIdentity } from "../../lib/db/gameRepository";
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
  whiteAfter: "+1.50",
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
  bestMoveSan: "c5",
  principalVariationSan: ["c5", "Nf3"],
};

const identity: CodexAdviceIdentity = {
  gameFingerprint: "game-one",
  positionIndex: 2,
  language: "en",
  analysisFingerprint: "facts-one",
  promptVersion: 2,
  schemaVersion: 2,
};

const codexAnswer: CodexAdviceResponse = {
  schemaVersion: 2,
  advice: {
    plan: "Challenge White’s centre with c5 before developing the kingside knight.",
  },
  model: "gpt-5.6-terra",
  reasoning: "medium",
  durationMs: 900,
};

describe("CoachPanel", () => {
  it("renders one tabless Plan with dominant rating, White evaluation, and compact Stockfish facts", () => {
    render(
      <CoachPanel
        insight={insight}
        repository={new MemoryGameRepository()}
        codexAvailable={false}
        t={(key, variables) => translate("en", key, variables)}
      />,
    );
    const panel = screen.getByRole("region", { name: "Coach" });
    const headline = screen.getByTestId("coach-rating-headline");
    const plan = screen.getByRole("region", { name: "Plan" });

    expect(headline.querySelector('[data-rating-icon="inaccuracy"]')).toBeInTheDocument();
    expect(headline).toHaveTextContent("Inaccuracy");
    expect(headline).toHaveTextContent("Played e5");
    expect(headline).toHaveTextContent("White evaluation+1.50");
    expect(plan).toHaveAttribute("tabindex", "0");
    plan.focus();
    expect(plan).toHaveFocus();
    expect(screen.getByLabelText("Stockfish principal variation")).toHaveTextContent("c5 Nf3");
    expect(panel).not.toHaveTextContent("What happened");
    expect(panel).not.toHaveTextContent("100 cp");
    expect(panel).not.toHaveTextContent("Compare at least two candidate moves");
    expect(panel).not.toHaveTextContent("not AI-generated");
    expect(screen.queryByRole("tab")).not.toBeInTheDocument();
  });

  it("localizes an unrated Plan state without generic coaching prose", () => {
    render(
      <CoachPanel
        insight={{
          ...insight,
          rating: { ...rated, classification: "notRated", reason: "missingEvaluation", centipawnLoss: null },
          before: null,
          after: null,
          whiteAfter: null,
          bestMoveSan: null,
          principalVariationSan: [],
          lineStatus: "missing",
          tip: "analyzeAdjacent",
        }}
        repository={new MemoryGameRepository()}
        codexAvailable
        t={(key, variables) => translate("fr", key, variables)}
      />,
    );
    const panel = screen.getByRole("region", { name: "Entraîneur" });
    expect(panel).toHaveTextContent("Non classé");
    expect(panel).toHaveTextContent("Sélectionnez un coup classé");
    expect(panel).not.toHaveTextContent("Analysez les deux positions adjacentes");
    expect(screen.queryByRole("tab")).not.toBeInTheDocument();
  });

  it("distinguishes selection, starting, loading, unavailable-engine, and unfinished states", () => {
    const repository = new MemoryGameRepository();
    const t = (key: Parameters<typeof translate>[1], variables?: Record<string, string | number>) =>
      translate("en", key, variables);
    const { rerender } = render(
      <CoachPanel insight={null} repository={repository} codexAvailable={false} t={t} />,
    );
    expect(screen.getByText("Select a move to see its coaching insight.")).toBeInTheDocument();
    rerender(<CoachPanel insight={null} emptyState="startingPosition" repository={repository} codexAvailable={false} t={t} />);
    expect(screen.getByText("Choose a played move to start the review.")).toBeInTheDocument();
    rerender(<CoachPanel insight={null} emptyState="engineLoading" repository={repository} codexAvailable={false} t={t} />);
    expect(screen.getByText("Looking for a local Stockfish engine.")).toBeInTheDocument();
    rerender(<CoachPanel insight={null} emptyState="analysisLoading" repository={repository} codexAvailable={false} t={t} />);
    expect(screen.getByText("Stockfish is analyzing this game.")).toBeInTheDocument();
    rerender(<CoachPanel insight={null} emptyState="stockfishUnavailable" repository={repository} codexAvailable={false} t={t} />);
    expect(screen.getByText("Stockfish is unavailable. Open Analysis settings to choose an engine.")).toBeInTheDocument();
    rerender(<CoachPanel insight={null} emptyState="unfinishedGame" repository={repository} codexAvailable={false} t={t} />);
    expect(screen.getByText("Coach guidance is available only for completed games.")).toBeInTheDocument();
  });

  it("shows only the current move Plan when the context changes", async () => {
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
        codexIdentity={identity}
        codexAvailable
        requestAdvice={requestAdvice}
        t={t}
      />,
    );

    fireEvent.click(await screen.findByRole("button", { name: "Ask Codex" }));
    expect(await screen.findByText(/Challenge White’s centre/)).toBeInTheDocument();
    await waitFor(() => expect(repository.getCodexAdvice(identity)).resolves.toMatchObject({
      plan: codexAnswer.advice.plan,
    }));

    rerender(
      <CoachPanel
        insight={null}
        repository={repository}
        codexRequest={null}
        codexIdentity={null}
        codexAvailable
        requestAdvice={requestAdvice}
        t={t}
      />,
    );
    expect(screen.queryByText(/Challenge White’s centre/)).not.toBeInTheDocument();
    expect(screen.getByText("Select a move to see its coaching insight.")).toBeInTheDocument();
  });
});
