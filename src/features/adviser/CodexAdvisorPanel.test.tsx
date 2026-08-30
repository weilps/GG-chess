import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { translate } from "../../i18n/translations";
import type { CodexAdviceIdentity, StoredCodexAdvice } from "../../lib/db/gameRepository";
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
  bestMoveSan: "e4",
  principalVariationSan: ["e4", "e5"],
};

const identity: CodexAdviceIdentity = {
  gameFingerprint: "game-one",
  positionIndex: 1,
  language: "en",
  analysisFingerprint: "analysis-one",
  promptVersion: 2,
  schemaVersion: 2,
};

const answer: CodexAdviceResponse = {
  schemaVersion: 2,
  advice: {
    plan: "Use the open centre before Black can finish development.",
  },
  model: "gpt-5.6-terra",
  reasoning: "medium",
  durationMs: 1_250,
};

function saved(overrides: Partial<StoredCodexAdvice> = {}): StoredCodexAdvice {
  return {
    ...identity,
    plan: "Saved local plan.",
    model: "gpt-5.6-terra",
    reasoning: "medium",
    durationMs: 900,
    updatedAt: "2026-08-30T00:00:00Z",
    ...overrides,
  };
}

const en = (key: Parameters<typeof translate>[1], variables?: Record<string, string | number>) =>
  translate("en", key, variables);
const fr = (key: Parameters<typeof translate>[1], variables?: Record<string, string | number>) =>
  translate("fr", key, variables);

describe("CodexAdvisorPanel", () => {
  it("requires explicit consent, stores one Plan locally, and removes cockpit disclaimers", async () => {
    const repository = new MemoryGameRepository();
    const requestAdvice = vi.fn().mockResolvedValue(answer);
    render(
      <CodexAdvisorPanel
        request={request}
        identity={identity}
        repository={repository}
        available
        requestAdvice={requestAdvice}
        t={en}
      />,
    );

    fireEvent.click(await screen.findByRole("button", { name: "Ask Codex" }));
    expect(requestAdvice).not.toHaveBeenCalled();
    expect(screen.getByText("Before sending this move")).toBeInTheDocument();
    expect(screen.getByText(/saved only in ChessMate’s local database/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Enable Codex adviser" }));
    await waitFor(() => expect(repository.getSetting("codexAdvisorEnabled")).resolves.toBe("true"));
    fireEvent.click(screen.getByRole("button", { name: "Ask Codex" }));
    expect(await screen.findByText(answer.advice.plan)).toBeInTheDocument();
    expect(await repository.getCodexAdvice(identity)).toMatchObject({ plan: answer.advice.plan });
    expect(screen.queryByText("Summary")).not.toBeInTheDocument();
    expect(screen.queryByText("Explanation")).not.toBeInTheDocument();
    expect(screen.queryByText("Practice")).not.toBeInTheDocument();
    expect(screen.queryByText("gpt-5.6-terra")).not.toBeInTheDocument();
    expect(screen.queryByText(/no separate API key/)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Disable" }));
    await waitFor(() => expect(repository.getSetting("codexAdvisorEnabled")).resolves.toBe("false"));
    expect(screen.queryByText(answer.advice.plan)).not.toBeInTheDocument();
  });

  it("restores saved Plans across remounts and keeps English and French identities separate", async () => {
    const repository = new MemoryGameRepository();
    const frenchIdentity: CodexAdviceIdentity = {
      ...identity,
      language: "fr",
      analysisFingerprint: "analysis-fr",
    };
    await repository.saveCodexAdvice(saved());
    await repository.saveCodexAdvice(saved({
      ...frenchIdentity,
      plan: "Plan français enregistré.",
    }));

    const first = render(
      <CodexAdvisorPanel request={request} identity={identity} repository={repository} available t={en} />,
    );
    expect(await screen.findByText("Saved local plan.")).toBeInTheDocument();
    first.unmount();

    const { rerender } = render(
      <CodexAdvisorPanel request={request} identity={identity} repository={repository} available t={en} />,
    );
    expect(await screen.findByText("Saved local plan.")).toBeInTheDocument();
    rerender(
      <CodexAdvisorPanel
        request={{ ...request, language: "fr" }}
        identity={frenchIdentity}
        repository={repository}
        available
        t={fr}
      />,
    );
    expect(await screen.findByText("Plan français enregistré.")).toBeInTheDocument();
    expect(screen.queryByText("Saved local plan.")).not.toBeInTheDocument();
  });

  it("regenerates by replacing only the current identity", async () => {
    const repository = new MemoryGameRepository();
    await repository.setSetting("codexAdvisorEnabled", "true");
    await repository.saveCodexAdvice(saved());
    render(
      <CodexAdvisorPanel
        request={request}
        identity={identity}
        repository={repository}
        available
        requestAdvice={vi.fn().mockResolvedValue(answer)}
        t={en}
      />,
    );
    expect(await screen.findByText("Saved local plan.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Regenerate" }));
    expect(await screen.findByText(answer.advice.plan)).toBeInTheDocument();
    expect(await repository.getCodexAdvice(identity)).toMatchObject({ plan: answer.advice.plan });
  });

  it("rejects a late response after the identity changes without persisting it", async () => {
    const repository = new MemoryGameRepository();
    await repository.setSetting("codexAdvisorEnabled", "true");
    let resolveAdvice: (value: CodexAdviceResponse) => void = () => undefined;
    const pending = new Promise<CodexAdviceResponse>((resolve) => { resolveAdvice = resolve; });
    const requestAdvice = vi.fn(() => pending);
    const nextIdentity: CodexAdviceIdentity = {
      ...identity,
      positionIndex: 2,
      analysisFingerprint: "analysis-two",
    };
    const { rerender } = render(
      <CodexAdvisorPanel request={request} identity={identity} repository={repository} available requestAdvice={requestAdvice} t={en} />,
    );
    fireEvent.click(await screen.findByRole("button", { name: "Ask Codex" }));
    expect(screen.getByText("Codex is thinking…")).toBeInTheDocument();

    rerender(
      <CodexAdvisorPanel request={{ ...request, san: "e5" }} identity={nextIdentity} repository={repository} available requestAdvice={requestAdvice} t={en} />,
    );
    resolveAdvice(answer);
    expect(await screen.findByRole("button", { name: "Ask Codex" })).toBeInTheDocument();
    expect(screen.queryByText(answer.advice.plan)).not.toBeInTheDocument();
    expect(await repository.getCodexAdvice(identity)).toBeNull();
    expect(await repository.getCodexAdvice(nextIdentity)).toBeNull();
  });

  it("does not let an older regeneration overwrite a newer remounted request", async () => {
    const repository = new MemoryGameRepository();
    await repository.setSetting("codexAdvisorEnabled", "true");
    await repository.saveCodexAdvice(saved());
    let resolveOlder: (value: CodexAdviceResponse) => void = () => undefined;
    let resolveNewer: (value: CodexAdviceResponse) => void = () => undefined;
    const older = new Promise<CodexAdviceResponse>((resolve) => { resolveOlder = resolve; });
    const newer = new Promise<CodexAdviceResponse>((resolve) => { resolveNewer = resolve; });
    const requestAdvice = vi.fn()
      .mockImplementationOnce(() => older)
      .mockImplementationOnce(() => newer);

    const first = render(
      <CodexAdvisorPanel request={request} identity={identity} repository={repository} available requestAdvice={requestAdvice} t={en} />,
    );
    fireEvent.click(await screen.findByRole("button", { name: "Regenerate" }));
    first.unmount();

    render(
      <CodexAdvisorPanel request={request} identity={identity} repository={repository} available requestAdvice={requestAdvice} t={en} />,
    );
    fireEvent.click(await screen.findByRole("button", { name: "Regenerate" }));
    resolveNewer({ ...answer, advice: { plan: "Newer tactical plan." } });
    expect(await screen.findByText("Newer tactical plan.")).toBeInTheDocument();
    resolveOlder({ ...answer, advice: { plan: "Older tactical plan." } });
    await waitFor(() => expect(repository.getCodexAdvice(identity)).resolves.toMatchObject({
      plan: "Newer tactical plan.",
    }));
    expect(screen.queryByText("Older tactical plan.")).not.toBeInTheDocument();
  });

  it.each([
    ["codex_not_logged_in", "Codex n’est pas connecté"],
    ["codex_timeout", "Codex n’a pas répondu"],
    ["codex_malformed_output", "réponse illisible"],
  ])("localizes %s without stale content", async (code, message) => {
    const repository = new MemoryGameRepository();
    await repository.setSetting("codexAdvisorEnabled", "true");
    render(
      <CodexAdvisorPanel
        request={{ ...request, language: "fr" }}
        identity={{ ...identity, language: "fr" }}
        repository={repository}
        available
        requestAdvice={vi.fn().mockRejectedValue(code)}
        t={fr}
      />,
    );
    fireEvent.click(await screen.findByRole("button", { name: "Demander à Codex" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(message);
    expect(screen.queryByText("Saved local plan.")).not.toBeInTheDocument();
  });

  it("rejects an outdated response schema as malformed", async () => {
    const repository = new MemoryGameRepository();
    await repository.setSetting("codexAdvisorEnabled", "true");
    render(
      <CodexAdvisorPanel
        request={request}
        identity={identity}
        repository={repository}
        available
        requestAdvice={vi.fn().mockResolvedValue({ ...answer, schemaVersion: 1 })}
        t={en}
      />,
    );
    fireEvent.click(await screen.findByRole("button", { name: "Ask Codex" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("unreadable answer");
    expect(await repository.getCodexAdvice(identity)).toBeNull();
  });

  it("states native and eligibility requirements without making a request", async () => {
    const repository = new MemoryGameRepository();
    const requestAdvice = vi.fn();
    const { rerender } = render(
      <CodexAdvisorPanel request={request} identity={identity} repository={repository} available={false} requestAdvice={requestAdvice} t={en} />,
    );
    expect(screen.getByText(/requires the ChessMate Windows app/)).toBeInTheDocument();
    rerender(
      <CodexAdvisorPanel request={null} identity={null} repository={repository} available requestAdvice={requestAdvice} t={en} />,
    );
    expect(screen.getByText(/Select a fully analyzed/)).toBeInTheDocument();
    expect(requestAdvice).not.toHaveBeenCalled();
  });
});
