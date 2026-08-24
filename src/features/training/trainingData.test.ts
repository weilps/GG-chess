import { Chess } from "chess.js";
import { describe, expect, it } from "vitest";
import type {
  PuzzleProgress,
  StoredAnalysisCache,
  TrainingActivity,
} from "../../lib/db/gameRepository";
import type { StoredGame } from "../../types";
import {
  buildOpeningRepertoire,
  buildPlayerTrends,
  buildQuestProgress,
  buildTrainingPuzzles,
  calculateTrainingStreak,
  checkPuzzleMove,
  findPlayerSide,
  localDay,
  orderRevengePuzzles,
  parsePlayerAliases,
  promotionChoices,
  updatePuzzleProgress,
  weekStartMonday,
  type TrainingPuzzle,
} from "./trainingData";

function game(
  fingerprint = "game-one",
  playedAt = "2026-08-20T10:00:00Z",
  result = "1-0",
): StoredGame {
  const chess = new Chess();
  const positions = [chess.fen()];
  const moves = ["e4", "e5", "Nf3", "Nc6"];
  for (const move of moves) {
    chess.move(move);
    positions.push(chess.fen());
  }
  return {
    fingerprint,
    white: "Ada",
    black: "Grace",
    result,
    playedAt,
    displayDate: playedAt.slice(0, 10),
    timeControl: "600+5",
    source: "test",
    rawPgn: "test",
    moves,
    positions,
    importedAt: playedAt,
  };
}

function cache(record: StoredGame, analyzedAt = "2026-08-21T00:00:00Z"): StoredAnalysisCache {
  return {
    gameFingerprint: record.fingerprint,
    engineName: "Stockfish",
    engineVersion: "18",
    profile: "balanced",
    analyzedAt,
    evaluations: record.positions.map((_, positionIndex) => ({
      gameFingerprint: record.fingerprint,
      engineName: "Stockfish",
      engineVersion: "18",
      profile: "balanced" as const,
      positionIndex,
      scoreCp: positionIndex === 0 ? 300 : 0,
      mate: null,
      depth: 18,
      bestMove: positionIndex === 0 ? "d2d4" : null,
      pv: positionIndex === 0 ? ["d2d4", "d7d5"] : [],
      analyzedAt,
    })),
  };
}

describe("training puzzles", () => {
  it("creates a puzzle only from a legal saved best move and preserves its facts", () => {
    const record = game();
    const puzzles = buildTrainingPuzzles([record], [cache(record)]);
    expect(puzzles).toHaveLength(1);
    expect(puzzles[0]).toMatchObject({
      moveIndex: 0,
      color: "white",
      playedMoveSan: "e4",
      bestMoveUci: "d2d4",
      bestMoveSan: "d4",
      principalVariationSan: ["d4", "d5"],
      rating: { classification: "miss", centipawnLoss: 300 },
    });

    const invalid = cache(record);
    invalid.evaluations[0] = { ...invalid.evaluations[0], bestMove: "a1a8" };
    expect(buildTrainingPuzzles([record], [invalid])).toEqual([]);
    const incomplete = cache(record);
    incomplete.evaluations.splice(2, 1);
    expect(buildTrainingPuzzles([record], [incomplete])).toEqual([]);
    const duplicateIndex = cache(record);
    duplicateIndex.evaluations[2] = {
      ...duplicateIndex.evaluations[2],
      positionIndex: 1,
    };
    expect(buildTrainingPuzzles([record], [duplicateIndex])).toEqual([]);
    expect(buildTrainingPuzzles([{ ...record, result: "*" }], [cache(record)])).toEqual([]);
  });

  it("checks exact legal UCI moves including underpromotions", () => {
    const puzzle = { fen: "7k/P7/8/8/8/8/8/7K w - - 0 1", bestMoveUci: "a7a8n" };
    expect(promotionChoices(puzzle.fen, "a7", "a8").sort()).toEqual(["b", "n", "q", "r"]);
    expect(checkPuzzleMove(puzzle, "a7", "a8", "q")).toMatchObject({ legal: true, correct: false });
    expect(checkPuzzleMove(puzzle, "a7", "a8", "n")).toMatchObject({ legal: true, correct: true, uci: "a7a8n" });
    expect(checkPuzzleMove(puzzle, "h1", "h8")).toMatchObject({ legal: false, correct: false });
  });

  it("schedules reveal/again/good/easy and orders due revenge positions", () => {
    const now = new Date(2026, 7, 25, 12);
    for (const [result, expectedDay, successes] of [
      ["revealed", "2026-08-26", 0],
      ["again", "2026-08-26", 1],
      ["good", "2026-08-28", 1],
      ["easy", "2026-09-01", 1],
    ] as const) {
      const scheduled = updatePuzzleProgress(undefined, "puzzle", result, now);
      expect(localDay(new Date(scheduled.dueAt))).toBe(expectedDay);
      expect(scheduled).toMatchObject({ attempts: 1, successes, lastResult: result });
    }

    const record = game();
    const base = buildTrainingPuzzles([record], [cache(record)])[0];
    const newer: TrainingPuzzle = {
      ...base,
      key: "newer",
      playedAt: "2026-08-24T00:00:00Z",
      rating: { ...base.rating, classification: "blunder" },
    };
    const old: TrainingPuzzle = {
      ...base,
      key: "old",
      playedAt: "2026-07-01T00:00:00Z",
      rating: { ...base.rating, classification: "mistake" },
    };
    const future: PuzzleProgress = {
      puzzleKey: "old",
      attempts: 1,
      successes: 1,
      lastResult: "easy",
      dueAt: "2026-09-01T00:00:00Z",
      updatedAt: "2026-08-25T00:00:00Z",
    };
    expect(orderRevengePuzzles([old, newer], [future], now).map((item) => item.key))
      .toEqual(["newer", "old"]);
  });
});

describe("quests, identity and summaries", () => {
  it("rolls weeks on Monday, deduplicates quests and calculates consecutive days", () => {
    expect(weekStartMonday(new Date(2026, 7, 30, 12))).toBe("2026-08-24");
    expect(weekStartMonday(new Date(2026, 7, 31, 12))).toBe("2026-08-31");
    const activities: TrainingActivity[] = [
      { weekStart: "2026-08-24", kind: "review", itemKey: "one", occurredOn: "2026-08-24", createdAt: "a" },
      { weekStart: "2026-08-24", kind: "review", itemKey: "one", occurredOn: "2026-08-25", createdAt: "b" },
      { weekStart: "2026-08-24", kind: "review", itemKey: "two", occurredOn: "2026-08-25", createdAt: "c" },
    ];
    expect(buildQuestProgress(activities, "2026-08-24")[0])
      .toMatchObject({ progress: 2, target: 3, completed: false });
    expect(buildQuestProgress(activities, "2026-08-31")[0])
      .toMatchObject({ progress: 0, target: 3, completed: false });
    expect(calculateTrainingStreak(
      ["2026-08-20", "2026-08-23", "2026-08-24", "2026-08-25"],
      new Date(2026, 7, 25, 12),
    )).toBe(3);
    expect(calculateTrainingStreak(["2026-08-20"], new Date(2026, 7, 25, 12))).toBe(0);
  });

  it("matches aliases, builds cautious trends and groups opening lines", () => {
    const aliases = parsePlayerAliases(" Ada, ADA , Other ");
    expect(aliases).toEqual(["ada", "other"]);
    expect(findPlayerSide(game(), aliases)).toBe("white");

    const first = game("first", "2026-08-20T00:00:00Z", "1-0");
    const second = { ...game("second", "2026-08-19T00:00:00Z", "1/2-1/2"), white: "Other" };
    const trends = buildPlayerTrends([first, second], [cache(first), cache(second)], aliases);
    expect(trends.recent).toMatchObject({ games: 2, scorePercent: 75 });
    expect(trends.insufficientComparison).toBe(true);

    const repertoire = buildOpeningRepertoire([first, second], [cache(first), cache(second)], aliases);
    expect(repertoire).toHaveLength(1);
    expect(repertoire[0]).toMatchObject({
      color: "white",
      moves: ["e4", "e5", "Nf3", "Nc6"],
      games: 2,
      wins: 1,
      draws: 1,
      losses: 0,
      scorePercent: 75,
      problems: 2,
    });
    expect(buildOpeningRepertoire([{ ...first, result: "*" }], [cache(first)], aliases)).toEqual([]);
  });

  it("keeps the trend warning until both five-game windows are complete", () => {
    const aliases = ["ada"];
    const records = Array.from({ length: 10 }, (_, index) => (
      game(`trend-${index}`, `2026-08-${String(20 - index).padStart(2, "0")}T00:00:00Z`)
    ));
    expect(buildPlayerTrends(records.slice(0, 9), records.slice(0, 9).map((item) => cache(item)), aliases)
      .insufficientComparison).toBe(true);
    expect(buildPlayerTrends(records, records.map((item) => cache(item)), aliases)
      .insufficientComparison).toBe(false);
  });
});
