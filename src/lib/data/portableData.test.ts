import { Chess } from "chess.js";
import { describe, expect, it } from "vitest";
import { parsePgnArchive } from "../pgn/parsePgnArchive";
import { MemoryGameRepository } from "../db/gameRepository";
import type { EngineInfo, ParsedGame } from "../../types";
import {
  buildPortableBackup,
  exportPgnArchive,
  parsePortableBackup,
  PortableDataError,
  serializePortableBackup,
} from "./portableData";

function sampleGame(): ParsedGame {
  const chess = new Chess();
  const positions = [chess.fen()];
  for (const move of ["e4", "e5"]) {
    chess.move(move);
    positions.push(chess.fen());
  }
  return {
    fingerprint: "portable-game",
    white: "Ada",
    black: "Grace",
    result: "1-0",
    playedAt: "2026-08-25T00:00:00Z",
    displayDate: "2026-08-25",
    timeControl: "600+5",
    source: "test",
    rawPgn: `[Event "Portable"]\n[White "Ada"]\n[Black "Grace"]\n[Result "1-0"]\n\n1. e4 e5 1-0`,
    moves: ["e4", "e5"],
    positions,
  };
}

async function populatedRepository(): Promise<MemoryGameRepository> {
  const repository = new MemoryGameRepository();
  const record = sampleGame();
  const engine: EngineInfo = { path: "C:\\machine-only\\stockfish.exe", name: "Stockfish", version: "18" };
  await repository.addGames([record]);
  await repository.saveEvaluations(record.fingerprint, engine, "balanced", [{
    positionIndex: 0,
    scoreCp: 20,
    mate: null,
    depth: 18,
    bestMove: "e2e4",
    pv: ["e2e4", "e7e5"],
  }]);
  await repository.saveChessComSyncState({
    username: "ada",
    yearMonth: "2026/08",
    etag: "etag",
    lastModified: null,
    completedAt: "2026-08-25T00:00:00Z",
    checkedAt: "2026-08-25T00:00:00Z",
  });
  await repository.savePuzzleProgress({
    puzzleKey: "portable-puzzle",
    attempts: 2,
    successes: 1,
    lastResult: "good",
    dueAt: "2026-08-28T00:00:00Z",
    updatedAt: "2026-08-25T00:00:00Z",
  });
  await repository.recordTrainingActivity({
    weekStart: "2026-08-24",
    kind: "review",
    itemKey: record.fingerprint,
    occurredOn: "2026-08-25",
    createdAt: "2026-08-25T00:00:00Z",
  });
  await repository.setSetting("analysisProfile", "balanced");
  await repository.setSetting("trainingCoachProfile", "playful");
  await repository.setSetting("enginePath", engine.path);
  await repository.setSetting("codexConsent", "true");
  return repository;
}

describe("portable ChessMate data", () => {
  it("round-trips every portable domain and excludes machine-only settings", async () => {
    const source = await populatedRepository();
    const backup = await buildPortableBackup(
      source,
      "fr",
      "0.1.0",
      new Date("2026-08-25T01:00:00Z"),
    );
    expect(backup.settings).toEqual({
      analysisProfile: "balanced",
      trainingCoachProfile: "playful",
    });
    expect(JSON.stringify(backup)).not.toContain("machine-only");
    expect(JSON.stringify(backup)).not.toContain("codexConsent");

    const parsed = parsePortableBackup(serializePortableBackup(backup));
    const target = new MemoryGameRepository();
    const first = await target.restorePortableData(parsed);
    expect(first.added).toBeGreaterThan(0);
    expect(first).toMatchObject({ updated: 0, rejected: 0 });
    expect(await target.listGames()).toEqual(await source.listGames());
    expect(await target.listAnalysisCaches()).toEqual(await source.listAnalysisCaches());
    expect(await target.listAllChessComSyncStates()).toEqual(await source.listAllChessComSyncStates());
    expect(await target.listPuzzleProgress()).toEqual(await source.listPuzzleProgress());
    expect(await target.listAllTrainingActivities()).toEqual(await source.listAllTrainingActivities());
    expect(await target.listTrainingDays()).toEqual(await source.listTrainingDays());

    const second = await target.restorePortableData(parsed);
    expect(second).toMatchObject({ added: 0, updated: 0, rejected: 0 });
    expect(second.unchanged).toBeGreaterThan(0);
  });

  it("rejects invalid JSON, incompatible schemas and incoherent data before restore", async () => {
    expect(() => parsePortableBackup("not json")).toThrowError(
      expect.objectContaining<Partial<PortableDataError>>({ code: "invalidJson" }),
    );
    expect(() => parsePortableBackup(JSON.stringify({ schemaVersion: 99 }))).toThrowError(
      expect.objectContaining<Partial<PortableDataError>>({ code: "unsupportedSchema" }),
    );
    const backup = await buildPortableBackup(await populatedRepository(), "en", "0.1.0");
    backup.games[0].positions = [];
    expect(() => parsePortableBackup(serializePortableBackup(backup))).toThrowError(
      expect.objectContaining<Partial<PortableDataError>>({ code: "invalidData" }),
    );
  });

  it("rejects an out-of-range cached position without mutating the target", async () => {
    const backup = await buildPortableBackup(await populatedRepository(), "en", "0.1.0");
    backup.analysisCaches[0].evaluations[0].positionIndex = 500;
    const target = new MemoryGameRepository();
    await target.setSetting("analysisProfile", "deep");
    const before = {
      games: await target.listGames(),
      profile: await target.getSetting("analysisProfile"),
    };

    expect(() => parsePortableBackup(serializePortableBackup(backup))).toThrowError(
      expect.objectContaining<Partial<PortableDataError>>({ code: "invalidData" }),
    );
    expect(await target.listGames()).toEqual(before.games);
    expect(await target.getSetting("analysisProfile")).toBe(before.profile);
  });

  it("exports a standard UTF-8 PGN archive that ChessMate can re-import", async () => {
    const repository = await populatedRepository();
    const contents = exportPgnArchive(await repository.listGames());
    const parsed = parsePgnArchive(contents);
    expect(parsed.games).toHaveLength(1);
    expect(parsed.games[0]).toMatchObject({ white: "Ada", black: "Grace", result: "1-0" });
    expect(exportPgnArchive([])).toBe("");
  });
});
