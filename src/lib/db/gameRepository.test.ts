import { describe, expect, it, vi } from "vitest";
import type { EngineInfo, ParsedGame, PositionEvaluation, StoredGame } from "../../types";
import {
  MemoryGameRepository,
  sortGamesNewestFirst,
} from "./gameRepository";

function game(fingerprint: string, playedAt: string | null): ParsedGame {
  return {
    fingerprint,
    white: "White",
    black: "Black",
    result: "1-0",
    playedAt,
    displayDate: playedAt?.slice(0, 10) ?? null,
    timeControl: null,
    source: null,
    rawPgn: "pgn",
    moves: ["e4"],
    positions: ["start", "after"],
  };
}

function evaluation(
  positionIndex: number,
  scoreCp: number,
  bestMove: string | null,
  pv: string[],
): PositionEvaluation {
  const rankOne = { rank: 1 as const, scoreCp, mate: null, depth: 18, bestMove, pv };
  return { positionIndex, ...rankOne, variations: [rankOne] };
}

describe("MemoryGameRepository", () => {
  it("deduplicates games by fingerprint", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-22T10:00:00Z"));
    const repository = new MemoryGameRepository();
    await repository.initialize();

    expect(await repository.addGames([game("one", null)])).toEqual({
      added: 1,
      duplicates: 0,
    });
    expect(await repository.addGames([game("one", null)])).toEqual({
      added: 0,
      duplicates: 1,
    });
    expect(await repository.listGames()).toHaveLength(1);
    vi.useRealTimers();
  });

  it("persists settings and isolates analysis caches by engine and profile", async () => {
    const repository = new MemoryGameRepository();
    const engine: EngineInfo = { path: "stockfish.exe", name: "Stockfish 18", version: "18" };
    await repository.setSetting("analysisProfile", "deep");
    await repository.saveEvaluations("one", engine, "balanced", 1, [
      evaluation(0, 35, "e2e4", ["e2e4", "e7e5"]),
    ]);

    expect(await repository.getSetting("analysisProfile")).toBe("deep");
    expect(await repository.getAnalysis("one", engine, "balanced", 1)).toMatchObject([
      { positionIndex: 0, scoreCp: 35, profile: "balanced" },
    ]);
    expect(await repository.getAnalysis("one", engine, "deep", 1)).toEqual([]);

    await repository.clearAnalysis("one", engine, "balanced", 1);
    expect(await repository.getAnalysis("one", engine, "balanced", 1)).toEqual([]);
  });

  it("persists monthly Chess.com sync markers per normalized username", async () => {
    const repository = new MemoryGameRepository();
    await repository.saveChessComSyncState({
      username: "ada",
      yearMonth: "2026-07",
      etag: "first",
      lastModified: null,
      completedAt: "2026-08-01T00:00:00Z",
      checkedAt: "2026-08-01T00:00:00Z",
    });
    await repository.saveChessComSyncState({
      username: "grace",
      yearMonth: "2026-07",
      etag: "other",
      lastModified: null,
      completedAt: null,
      checkedAt: "2026-08-01T00:00:00Z",
    });
    await repository.saveChessComSyncState({
      username: "ada",
      yearMonth: "2026-07",
      etag: "updated",
      lastModified: "Fri, 21 Aug 2026 00:00:00 GMT",
      completedAt: "2026-08-21T00:00:00Z",
      checkedAt: "2026-08-21T00:00:00Z",
    });

    expect(await repository.listChessComSyncStates("ada")).toEqual([{
      username: "ada",
      yearMonth: "2026-07",
      etag: "updated",
      lastModified: "Fri, 21 Aug 2026 00:00:00 GMT",
      completedAt: "2026-08-21T00:00:00Z",
      checkedAt: "2026-08-21T00:00:00Z",
    }]);
  });

  it("groups analysis caches and persists training progress idempotently", async () => {
    const repository = new MemoryGameRepository();
    const engine: EngineInfo = { path: "stockfish.exe", name: "Stockfish", version: "18" };
    await repository.saveEvaluations("one", engine, "balanced", 1, [
      evaluation(0, 30, "e2e4", ["e2e4"]),
      evaluation(1, 20, "e7e5", ["e7e5"]),
    ]);
    expect(await repository.listAnalysisCaches()).toMatchObject([{
      gameFingerprint: "one",
      engineName: "Stockfish",
      profile: "balanced",
      evaluations: [{ positionIndex: 0 }, { positionIndex: 1 }],
    }]);

    const progress = {
      puzzleKey: "one|0",
      attempts: 2,
      successes: 1,
      lastResult: "good" as const,
      dueAt: "2026-08-28T00:00:00Z",
      updatedAt: "2026-08-25T00:00:00Z",
    };
    await repository.savePuzzleProgress(progress);
    expect(await repository.listPuzzleProgress()).toEqual([progress]);

    const activity = {
      weekStart: "2026-08-24",
      kind: "review" as const,
      itemKey: "one",
      occurredOn: "2026-08-25",
      createdAt: "2026-08-25T01:00:00Z",
    };
    await repository.recordTrainingActivity(activity);
    await repository.recordTrainingActivity({ ...activity, createdAt: "later" });
    expect(await repository.listTrainingActivities("2026-08-24")).toEqual([activity]);
    expect(await repository.listTrainingDays()).toEqual(["2026-08-25"]);
  });

  it("keeps one-line and three-line caches independently", async () => {
    const repository = new MemoryGameRepository();
    const engine: EngineInfo = { path: "stockfish.exe", name: "Stockfish", version: "18" };
    const rankOne = evaluation(0, 30, "e2e4", ["e2e4"]);
    const threeLines: PositionEvaluation = {
      ...rankOne,
      variations: [
        rankOne.variations[0],
        { rank: 2, scoreCp: 20, mate: null, depth: 18, bestMove: "d2d4", pv: ["d2d4"] },
        { rank: 3, scoreCp: 10, mate: null, depth: 18, bestMove: "g1f3", pv: ["g1f3"] },
      ],
    };

    await repository.saveEvaluations("one", engine, "balanced", 1, [rankOne]);
    await repository.saveEvaluations("one", engine, "balanced", 3, [threeLines]);
    expect(await repository.getAnalysis("one", engine, "balanced", 1)).toMatchObject([
      { multiPv: 1, variations: [{ rank: 1 }] },
    ]);
    expect(await repository.getAnalysis("one", engine, "balanced", 3)).toMatchObject([
      { multiPv: 3, variations: [{ rank: 1 }, { rank: 2 }, { rank: 3 }] },
    ]);

    await repository.clearAnalysis("one", engine, "balanced", 3);
    expect(await repository.getAnalysis("one", engine, "balanced", 3)).toEqual([]);
    expect(await repository.getAnalysis("one", engine, "balanced", 1)).toHaveLength(1);
  });
});

describe("sortGamesNewestFirst", () => {
  it("sorts known dates newest first and unknown dates last", () => {
    const records = [
      { ...game("unknown", null), importedAt: "2026-08-22T10:00:00Z" },
      { ...game("older", "2026-07-01T00:00:00Z"), importedAt: "2026-08-22T10:00:00Z" },
      { ...game("newer", "2026-08-01T00:00:00Z"), importedAt: "2026-08-22T10:00:00Z" },
    ] satisfies StoredGame[];

    expect(sortGamesNewestFirst(records).map((record) => record.fingerprint)).toEqual([
      "newer",
      "older",
      "unknown",
    ]);
  });
});
