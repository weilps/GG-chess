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

    render(<EnginePanel game={game} positionIndex={0} repository={repository} t={t} />);
    expect(await screen.findByText("+0.35")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Analysis profile"), { target: { value: "deep" } });

    const analyzeButton = screen.getByRole("button", { name: "Analyze" });
    expect(analyzeButton).toBeDisabled();
    expect(screen.queryByText("+0.35")).not.toBeInTheDocument();
    expect(screen.getByText(/Loading the analysis cache/)).toBeInTheDocument();
    fireEvent.click(analyzeButton);
    expect(mocks.analyzePositions).not.toHaveBeenCalled();

    await act(async () => finishDeepLoad?.([]));
    await waitFor(() => expect(screen.getByRole("button", { name: "Analyze" })).toBeEnabled());
  });
});
