import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { translate } from "../../i18n/translations";
import { MemoryGameRepository } from "../../lib/db/gameRepository";
import { CodexAdvisorPanel } from "./CodexAdvisorPanel";
import type { CodexAdviceRequest, CodexAdviceResponse } from "./codexClient";

const request: CodexAdviceRequest = {
  language: "en",
  fenBefore: "start fen",
  fenAfter: "after fen",
  san: "e4",
  color: "white",
  result: "1-0",
  classification: "best",
  reason: "engineBest",
  centipawnLoss: 0,
  before: "+0.20",
  after: "+0.20",
  bestMoveSan: "e4",
  principalVariationSan: ["e4", "e5"],
};

const answer: CodexAdviceResponse = {
  schemaVersion: 1,
  advice: {
    summary: "You kept the position healthy.",
    explanation: "The move matched Stockfish.",
    plan: "Keep comparing candidates.",
    practice: "Find two candidates in five positions.",
  },
  model: "gpt-5.6-terra",
  reasoning: "medium",
  durationMs: 1_250,
};

describe("CodexAdvisorPanel", () => {
  it("requires remembered consent before an explicit request and never persists the answer", async () => {
    const repository = new MemoryGameRepository();
    const requestAdvice = vi.fn().mockResolvedValue(answer);
    render(
      <CodexAdvisorPanel
        request={request}
        repository={repository}
        available
        requestAdvice={requestAdvice}
        t={(key, variables) => translate("en", key, variables)}
      />,
    );

    fireEvent.click(await screen.findByRole("button", { name: "Ask Codex" }));
    expect(requestAdvice).not.toHaveBeenCalled();
    expect(screen.getByText("Before sending this move")).toBeInTheDocument();
    expect(screen.getByText(/No player name, raw PGN/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Enable Codex adviser" }));
    await waitFor(() => expect(repository.getSetting("codexAdvisorEnabled")).resolves.toBe("true"));
    fireEvent.click(screen.getByRole("button", { name: "Ask Codex" }));
    await waitFor(() => expect(requestAdvice).toHaveBeenCalledTimes(1));
    expect(await screen.findByText("You kept the position healthy.")).toBeInTheDocument();
    expect(screen.getByText("gpt-5.6-terra")).toBeInTheDocument();
    expect(screen.getByText("medium")).toBeInTheDocument();
    expect(screen.getByText("1.3 s")).toBeInTheDocument();
    expect(screen.getByText(/no separate API key/)).toBeInTheDocument();
    expect(await repository.getSetting("codexAdvice")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Disable" }));
    await waitFor(() => expect(repository.getSetting("codexAdvisorEnabled")).resolves.toBe("false"));
  });

  it("localizes actionable failures in French", async () => {
    const repository = new MemoryGameRepository();
    await repository.setSetting("codexAdvisorEnabled", "true");
    render(
      <CodexAdvisorPanel
        request={{ ...request, language: "fr" }}
        repository={repository}
        available
        requestAdvice={vi.fn().mockRejectedValue("codex_not_logged_in")}
        t={(key, variables) => translate("fr", key, variables)}
      />,
    );
    fireEvent.click(await screen.findByRole("button", { name: "Demander à Codex" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Codex n’est pas connecté");
  });

  it("ignores a late response after the selected context changes", async () => {
    const repository = new MemoryGameRepository();
    await repository.setSetting("codexAdvisorEnabled", "true");
    let resolveAdvice: (value: CodexAdviceResponse) => void = () => undefined;
    const pending = new Promise<CodexAdviceResponse>((resolve) => { resolveAdvice = resolve; });
    const requestAdvice = vi.fn(() => pending);
    const t = (key: Parameters<typeof translate>[1], variables?: Record<string, string | number>) =>
      translate("en", key, variables);
    const { rerender } = render(
      <CodexAdvisorPanel key="first" request={request} repository={repository} available requestAdvice={requestAdvice} t={t} />,
    );
    fireEvent.click(await screen.findByRole("button", { name: "Ask Codex" }));
    expect(screen.getByText("Codex is thinking…")).toBeInTheDocument();

    rerender(
      <CodexAdvisorPanel key="second" request={null} repository={repository} available requestAdvice={requestAdvice} t={t} />,
    );
    resolveAdvice(answer);
    await waitFor(() => expect(screen.getByText(/Select a fully analyzed/)).toBeInTheDocument());
    expect(screen.queryByText("You kept the position healthy.")).not.toBeInTheDocument();
  });

  it("states native and eligibility requirements without making a request", async () => {
    const repository = new MemoryGameRepository();
    const requestAdvice = vi.fn();
    const t = (key: Parameters<typeof translate>[1], variables?: Record<string, string | number>) =>
      translate("en", key, variables);
    const { rerender } = render(
      <CodexAdvisorPanel request={request} repository={repository} available={false} requestAdvice={requestAdvice} t={t} />,
    );
    expect(await screen.findByText(/requires the ChessMate Windows app/)).toBeInTheDocument();
    rerender(
      <CodexAdvisorPanel request={null} repository={repository} available requestAdvice={requestAdvice} t={t} />,
    );
    expect(screen.getByText(/Select a fully analyzed/)).toBeInTheDocument();
    expect(requestAdvice).not.toHaveBeenCalled();
  });
});
