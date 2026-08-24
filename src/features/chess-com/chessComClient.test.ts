import { describe, expect, it, vi } from "vitest";
import { MemoryGameRepository } from "../../lib/db/gameRepository";
import type { ChessComTransport } from "./chessComClient";
import {
  normalizeChessComUsername,
  syncChessComGames,
} from "./chessComClient";

const finishedPgn = `[Event "Live Chess"]
[Site "https://www.chess.com/game/live/1"]
[Date "2026.08.24"]
[White "Ada"]
[Black "Grace"]
[Result "1-0"]

1. e4 e5 2. Nf3 1-0`;

function transport(
  months: string[],
  gamesByMonth: Record<string, { pgn: string; rules: string }[]>,
): ChessComTransport {
  return {
    fetchArchives: vi.fn().mockResolvedValue({
      notModified: false,
      months,
      etag: "archives-v1",
      lastModified: null,
    }),
    fetchMonth: vi.fn(async ({ year, month, etag }) => {
      const yearMonth = `${year}-${String(month).padStart(2, "0")}`;
      if (etag === `etag-${yearMonth}`) {
        return { notModified: true, games: [], etag, lastModified: null };
      }
      return {
        notModified: false,
        games: gamesByMonth[yearMonth] ?? [],
        etag: `etag-${yearMonth}`,
        lastModified: null,
      };
    }),
  };
}

describe("normalizeChessComUsername", () => {
  it("trims, lowercases and rejects unsafe names", () => {
    expect(normalizeChessComUsername("  Ada_Player-2 ")).toBe("ada_player-2");
    for (const value of ["", "-ada", "ada-", "ada/player", "échec"]) {
      expect(() => normalizeChessComUsername(value)).toThrow("chess_com_invalid_username");
    }
  });
});

describe("syncChessComGames", () => {
  it("fetches months strictly in series and deduplicates a repeated latest month", async () => {
    const repository = new MemoryGameRepository();
    const active = { count: 0, max: 0 };
    const base = transport(["2026-07", "2026-08"], {
      "2026-07": [{ pgn: finishedPgn.replace("2026.08.24", "2026.07.24"), rules: "chess" }],
      "2026-08": [{ pgn: finishedPgn, rules: "chess" }],
    });
    const fetchMonth = base.fetchMonth;
    base.fetchMonth = vi.fn(async (request) => {
      active.count += 1;
      active.max = Math.max(active.max, active.count);
      await Promise.resolve();
      const response = await fetchMonth(request);
      active.count -= 1;
      return response;
    });

    const first = await syncChessComGames({ username: "Ada", repository, transport: base });
    const second = await syncChessComGames({ username: "ada", repository, transport: base });

    expect(active.max).toBe(1);
    expect(first).toMatchObject({ added: 2, duplicates: 0, monthsChecked: 2 });
    expect(second).toMatchObject({ added: 0, duplicates: 0, monthsChecked: 1, monthsSkipped: 1, monthsUnchanged: 1 });
    expect(await repository.listGames()).toHaveLength(2);
    expect(base.fetchMonth).toHaveBeenCalledTimes(3);
  });

  it("ignores variants and unfinished or invalid PGNs", async () => {
    const repository = new MemoryGameRepository();
    const unfinished = finishedPgn.replaceAll("1-0", "*");
    const api = transport(["2026-08"], {
      "2026-08": [
        { pgn: finishedPgn, rules: "chess960" },
        { pgn: unfinished, rules: "chess" },
        { pgn: "not pgn", rules: "chess" },
      ],
    });
    const result = await syncChessComGames({ username: "ada", repository, transport: api });
    expect(result.variantsIgnored).toBe(1);
    expect(result.rejections).toHaveLength(2);
    expect(result.added).toBe(0);
  });

  it("stops before the next month and preserves completed work", async () => {
    const repository = new MemoryGameRepository();
    const api = transport(["2026-06", "2026-07", "2026-08"], {
      "2026-06": [{ pgn: finishedPgn.replace("2026.08.24", "2026.06.24"), rules: "chess" }],
    });
    let requested = 0;
    const original = api.fetchMonth;
    api.fetchMonth = vi.fn(async (request) => {
      requested += 1;
      return original(request);
    });
    const result = await syncChessComGames({
      username: "ada",
      repository,
      transport: api,
      isCancelled: () => requested === 1,
    });
    expect(result).toMatchObject({ added: 1, monthsChecked: 1, cancelled: true });
    expect(await repository.listGames()).toHaveLength(1);
    expect(await repository.listChessComSyncStates("ada")).toHaveLength(1);
  });

  it("keeps earlier months when a later request fails", async () => {
    const repository = new MemoryGameRepository();
    const api = transport(["2026-07", "2026-08"], {
      "2026-07": [{ pgn: finishedPgn.replace("2026.08.24", "2026.07.24"), rules: "chess" }],
    });
    const original = api.fetchMonth;
    api.fetchMonth = vi.fn(async (request) => {
      if (request.month === 8) throw new Error("chess_com_timeout");
      return original(request);
    });
    await expect(syncChessComGames({ username: "ada", repository, transport: api }))
      .rejects.toThrow("chess_com_timeout");
    expect(await repository.listGames()).toHaveLength(1);
    expect(await repository.listChessComSyncStates("ada")).toHaveLength(1);
  });
});
