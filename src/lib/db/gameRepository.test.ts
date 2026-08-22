import { describe, expect, it, vi } from "vitest";
import type { ParsedGame, StoredGame } from "../../types";
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
