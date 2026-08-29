import { Chess } from "chess.js";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { translate } from "../../i18n/translations";
import { MemoryGameRepository } from "../../lib/db/gameRepository";
import type { EngineInfo, StoredGame } from "../../types";
import { weekStartMonday } from "./trainingData";
import { TrainingScreen } from "./TrainingScreen";

function analyzedGame(): StoredGame {
  const chess = new Chess();
  const positions = [chess.fen()];
  const moves = ["e4", "e5"];
  for (const move of moves) {
    chess.move(move);
    positions.push(chess.fen());
  }
  return {
    fingerprint: "training-game",
    white: "Ada",
    black: "Grace",
    result: "1-0",
    playedAt: "2026-08-20T00:00:00Z",
    displayDate: "2026-08-20",
    timeControl: null,
    source: null,
    rawPgn: "",
    moves,
    positions,
    importedAt: "2026-08-20T00:00:00Z",
  };
}

describe("TrainingScreen", () => {
  it("explains the empty local-only state in French", async () => {
    render(
      <TrainingScreen
        games={[]}
        repository={new MemoryGameRepository()}
        onBack={vi.fn()}
        t={(key, variables) => translate("fr", key, variables)}
      />,
    );
    expect(await screen.findByText("Aucune position revanche pour l’instant")).toBeInTheDocument();
    expect(screen.getByText(/Analysez une partie terminée/)).toBeInTheDocument();
    expect(screen.getByText(/aucun réseau, LLM, télémétrie/)).toBeInTheDocument();
  });

  it("changes coach tone without changing facts and persists a revealed puzzle", async () => {
    const repository = new MemoryGameRepository();
    const record = analyzedGame();
    const engine: EngineInfo = { path: "stockfish.exe", name: "Stockfish", version: "18" };
    await repository.saveEvaluations(record.fingerprint, engine, "balanced", 1, [
      { positionIndex: 0, scoreCp: 300, mate: null, depth: 18, bestMove: "d2d4", pv: ["d2d4", "d7d5"], variations: [{ rank: 1, scoreCp: 300, mate: null, depth: 18, bestMove: "d2d4", pv: ["d2d4", "d7d5"] }] },
      { positionIndex: 1, scoreCp: 0, mate: null, depth: 18, bestMove: "e7e5", pv: ["e7e5"], variations: [{ rank: 1, scoreCp: 0, mate: null, depth: 18, bestMove: "e7e5", pv: ["e7e5"] }] },
      { positionIndex: 2, scoreCp: 0, mate: null, depth: 18, bestMove: null, pv: [], variations: [{ rank: 1, scoreCp: 0, mate: null, depth: 18, bestMove: null, pv: [] }] },
    ]);
    render(
      <TrainingScreen
        games={[record]}
        repository={repository}
        onBack={vi.fn()}
        t={(key, variables) => translate("en", key, variables)}
      />,
    );

    expect(await screen.findByText("Your move. Rewrite this moment.")).toBeInTheDocument();
    expect(screen.getByText("Miss")).toBeInTheDocument();
    await userEvent.selectOptions(screen.getByLabelText("Coach profile"), "playful");
    expect(screen.getByText(/Past-you left a little mess/)).toBeInTheDocument();
    expect(screen.getByText("Miss")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Reveal the saved move" }));
    expect(await screen.findByText("Saved answer: d4")).toBeInTheDocument();
    expect(await repository.listPuzzleProgress()).toMatchObject([{
      lastResult: "revealed",
      attempts: 1,
      successes: 0,
    }]);
    expect(await repository.listTrainingActivities(weekStartMonday(new Date()))).toHaveLength(1);
  }, 15_000);

  it("rolls weekly quest progress at local Monday without remounting", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 7, 30, 23, 59, 59));
    const repository = new MemoryGameRepository();
    await repository.recordTrainingActivity({
      weekStart: "2026-08-24",
      kind: "review",
      itemKey: "old-week-game",
      occurredOn: "2026-08-30",
      createdAt: "2026-08-30T12:00:00Z",
    });
    render(
      <TrainingScreen
        games={[]}
        repository={repository}
        onBack={vi.fn()}
        t={(key, variables) => translate("en", key, variables)}
      />,
    );
    await act(async () => { await Promise.resolve(); });
    expect(screen.getByText("1/3")).toBeInTheDocument();

    await act(async () => { await vi.advanceTimersByTimeAsync(2_000); });
    expect(screen.queryByText("1/3")).not.toBeInTheDocument();
    expect(screen.getAllByText("0/3")).toHaveLength(2);
    vi.useRealTimers();
  });
});
