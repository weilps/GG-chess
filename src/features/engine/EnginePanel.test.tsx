import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { translate } from "../../i18n/translations";
import { MemoryGameRepository } from "../../lib/db/gameRepository";
import type { PositionEvaluation, StoredGame } from "../../types";
import { EnginePanel } from "./EnginePanel";

const mocks = vi.hoisted(() => ({
  analyzePositions: vi.fn(),
  cancelAnalysis: vi.fn(),
  detectStockfish: vi.fn(),
  subscribe: vi.fn(),
}));

vi.mock("./engineClient", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./engineClient")>();
  return {
    ...actual,
    engineAvailable: () => true,
    detectStockfish: mocks.detectStockfish,
    analyzePositions: mocks.analyzePositions,
    cancelAnalysis: mocks.cancelAnalysis,
    subscribeToAnalysisProgress: mocks.subscribe,
  };
});

const engine = { path: "C:\\stockfish.exe", name: "Stockfish 18", version: "18" };
const game: StoredGame = {
  fingerprint: "analysis-game",
  white: "Ada",
  black: "Grace",
  result: "1-0",
  playedAt: null,
  displayDate: null,
  timeControl: null,
  source: null,
  rawPgn: "",
  moves: ["e4"],
  positions: ["start w - - 0 1", "after b - - 0 1"],
  importedAt: "2026-08-22T00:00:00Z",
};
const t = (key: Parameters<typeof translate>[1], variables?: Record<string, string | number>) =>
  translate("en", key, variables);

describe("EnginePanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.detectStockfish.mockResolvedValue(engine);
    mocks.cancelAnalysis.mockResolvedValue(true);
    mocks.subscribe.mockResolvedValue(() => undefined);
  });

  it("restores cached evaluations and follows the selected position", async () => {
    const repository = new MemoryGameRepository();
    await repository.saveEvaluations(game.fingerprint, engine, "balanced", [
      { positionIndex: 0, scoreCp: 35, mate: null, depth: 18, bestMove: "e2e4", pv: ["e2e4", "e7e5"] },
      { positionIndex: 1, scoreCp: -120, mate: null, depth: 18, bestMove: "e7e5", pv: ["e7e5"] },
    ]);
    const view = render(<EnginePanel game={game} positionIndex={0} repository={repository} t={t} />);

    expect(await screen.findByText("+0.35")).toBeInTheDocument();
    expect(screen.getByLabelText("Best variation")).toHaveTextContent("e2e4 e7e5");
    view.rerender(<EnginePanel game={game} positionIndex={1} repository={repository} t={t} />);
    expect(screen.getByText("-1.20")).toBeInTheDocument();
  });

  it("reports progress, requests cancellation, and keeps partial results", async () => {
    const repository = new MemoryGameRepository();
    let progressHandler: ((update: {
      analysisId: string;
      current: number;
      total: number;
      evaluation: PositionEvaluation;
    }) => void) | undefined;
    let finish: ((value: { evaluations: PositionEvaluation[]; cancelled: boolean }) => void) | undefined;
    const evaluation: PositionEvaluation = {
      positionIndex: 0,
      scoreCp: 20,
      mate: null,
      depth: 18,
      bestMove: "e2e4",
      pv: ["e2e4"],
    };
    mocks.subscribe.mockImplementation(async (handler) => {
      progressHandler = handler;
      return () => undefined;
    });
    mocks.analyzePositions.mockImplementation(() => new Promise((resolve) => { finish = resolve; }));

    render(<EnginePanel game={game} positionIndex={0} repository={repository} t={t} />);
    await screen.findByText(/Stockfish 18/);
    const analyzeButton = screen.getByRole("button", { name: "Analyze" });
    await waitFor(() => expect(analyzeButton).toBeEnabled());
    fireEvent.click(analyzeButton);
    await waitFor(() => expect(progressHandler).toBeDefined());
    const analysisId = mocks.analyzePositions.mock.calls[0][0].analysisId as string;
    act(() => progressHandler?.({ analysisId, current: 1, total: 2, evaluation }));
    expect(screen.getByText("Position 1 of 2")).toBeInTheDocument();
    expect(screen.getByText("+0.20")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(mocks.cancelAnalysis).toHaveBeenCalledWith(analysisId));
    await act(async () => finish?.({ evaluations: [evaluation], cancelled: true }));
    expect(await screen.findByText(/Partial results were saved/)).toBeInTheDocument();
    expect(await repository.getAnalysis(game.fingerprint, engine, "balanced")).toHaveLength(1);
  });

  it("hides the previous cache and disables analysis while a new profile loads", async () => {
    const repository = new MemoryGameRepository();
    const onAnalysisStateChange = vi.fn();
    await repository.saveEvaluations(game.fingerprint, engine, "balanced", [{
      positionIndex: 0,
      scoreCp: 35,
      mate: null,
      depth: 18,
      bestMove: "e2e4",
      pv: ["e2e4"],
    }]);
    const originalGetAnalysis = repository.getAnalysis.bind(repository);
    let finishDeepLoad: ((value: Awaited<ReturnType<typeof repository.getAnalysis>>) => void) | undefined;
    vi.spyOn(repository, "getAnalysis").mockImplementation((fingerprint, selectedEngine, profile) => {
      if (profile === "deep") {
        return new Promise((resolve) => { finishDeepLoad = resolve; });
      }
      return originalGetAnalysis(fingerprint, selectedEngine, profile);
    });

    render(
      <EnginePanel
        game={game}
        positionIndex={0}
        repository={repository}
        t={t}
        onAnalysisStateChange={onAnalysisStateChange}
      />,
    );
    expect(await screen.findByText("+0.35")).toBeInTheDocument();
    await waitFor(() => expect(onAnalysisStateChange).toHaveBeenCalledWith(expect.objectContaining({
      evaluations: [expect.objectContaining({ scoreCp: 35 })],
      loading: false,
      profile: "balanced",
    })));
    fireEvent.change(screen.getByLabelText("Analysis profile"), { target: { value: "deep" } });

    const analyzeButton = screen.getByRole("button", { name: "Analyze" });
    expect(analyzeButton).toBeDisabled();
    expect(screen.queryByText("+0.35")).not.toBeInTheDocument();
    expect(screen.getByText(/Loading the analysis cache/)).toBeInTheDocument();
    expect(onAnalysisStateChange).toHaveBeenCalledWith(expect.objectContaining({
      evaluations: [],
      loading: true,
      profile: "deep",
    }));
    expect(onAnalysisStateChange).not.toHaveBeenCalledWith(expect.objectContaining({
      evaluations: [expect.objectContaining({ scoreCp: 35 })],
      profile: "deep",
    }));
    fireEvent.click(analyzeButton);
    expect(mocks.analyzePositions).not.toHaveBeenCalled();

    await act(async () => finishDeepLoad?.([]));
    await waitFor(() => expect(screen.getByRole("button", { name: "Analyze" })).toBeEnabled());
    expect(onAnalysisStateChange).toHaveBeenLastCalledWith(expect.objectContaining({
      evaluations: [],
      loading: false,
      profile: "deep",
    }));
  });

  it.each([
    [0, "Analyze"],
    [1, "Resume analysis"],
    [2, "Re-analyze"],
  ] as const)("invalidates adviser facts synchronously when %s cached positions use %s", async (cachedCount, action) => {
    const repository = new MemoryGameRepository();
    const onAnalysisStateChange = vi.fn();
    const cached: PositionEvaluation[] = [
      { positionIndex: 0, scoreCp: 35, mate: null, depth: 18, bestMove: "e2e4", pv: ["e2e4"] },
      { positionIndex: 1, scoreCp: 20, mate: null, depth: 18, bestMove: null, pv: [] },
    ].slice(0, cachedCount);
    await repository.saveEvaluations(game.fingerprint, engine, "balanced", cached);
    mocks.analyzePositions.mockImplementation(() => new Promise(() => undefined));

    render(
      <EnginePanel
        game={game}
        positionIndex={0}
        repository={repository}
        t={t}
        onAnalysisStateChange={onAnalysisStateChange}
      />,
    );
    const button = await screen.findByRole("button", { name: action });
    await waitFor(() => expect(button).toBeEnabled());
    onAnalysisStateChange.mockClear();
    fireEvent.click(button);

    expect(onAnalysisStateChange).toHaveBeenCalledWith({
      cacheKey: null,
      evaluations: [],
      loading: true,
      profile: "balanced",
    });
    await waitFor(() => expect(onAnalysisStateChange).toHaveBeenLastCalledWith(expect.objectContaining({
      loading: true,
      profile: "balanced",
    })));
    expect(onAnalysisStateChange).not.toHaveBeenCalledWith(expect.objectContaining({ loading: false }));
  });

  it("opens compact settings and returns focus when dismissed", async () => {
    render(<EnginePanel compact game={game} positionIndex={0} repository={new MemoryGameRepository()} t={t} />);

    const settingsButton = screen.getByRole("button", { name: "Settings" });
    fireEvent.click(settingsButton);
    expect(await screen.findByRole("dialog", { name: "Local analysis" })).toBeInTheDocument();
    expect(await screen.findByText(/Stockfish 18/)).toBeInTheDocument();
    const closeButton = screen.getByRole("button", { name: "Close" });
    await waitFor(() => expect(closeButton).toHaveFocus());

    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByRole("dialog", { name: "Local analysis" })).not.toBeInTheDocument();
    expect(settingsButton).toHaveFocus();

    fireEvent.click(settingsButton);
    expect(screen.getByRole("dialog", { name: "Local analysis" })).toBeInTheDocument();
    fireEvent.pointerDown(document.body);
    expect(screen.queryByRole("dialog", { name: "Local analysis" })).not.toBeInTheDocument();
    expect(settingsButton).toHaveFocus();
  });

  it("automatically exposes compact analysis failures and keeps their status on Settings", async () => {
    mocks.analyzePositions.mockRejectedValueOnce(new Error("engine_timeout"));
    render(<EnginePanel compact game={game} positionIndex={0} repository={new MemoryGameRepository()} t={t} />);

    const analyzeButton = screen.getByRole("button", { name: "Analyze" });
    await waitFor(() => expect(analyzeButton).toBeEnabled());
    fireEvent.click(analyzeButton);

    expect(await screen.findByRole("dialog", { name: "Local analysis" })).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent(t("engineErrorTimeout"));
    expect(screen.getByRole("button", { name: `Settings: ${t("engineErrorTimeout")}` })).toBeInTheDocument();
  });
});
