import { Chess } from "chess.js";
import { describe, expect, it } from "vitest";
import type { StoredGame } from "../../types";
import type { CoachInsight } from "../coach/coachInsight";
import {
  CODEX_PROMPT_VERSION,
  CODEX_SCHEMA_VERSION,
  buildCodexAdviceIdentity,
  buildCodexAdviceRequest,
  codexAdviceIdentityKey,
  codexErrorCode,
} from "./codexClient";

function fixture(): { game: StoredGame; insight: CoachInsight } {
  const chess = new Chess();
  const positions = [chess.fen()];
  chess.move("e4");
  positions.push(chess.fen());
  return {
    game: {
      fingerprint: "private-fingerprint",
      white: "Private White",
      black: "Private Black",
      result: "1-0",
      playedAt: null,
      displayDate: null,
      timeControl: null,
      source: "https://chess.com/private-user",
      rawPgn: "[Private PGN]",
      moves: ["e4"],
      positions,
      importedAt: "2026-08-25T00:00:00Z",
    },
    insight: {
      rating: {
        moveIndex: 0,
        positionIndex: 1,
        color: "white",
        san: "e4",
        uci: "e2e4",
        classification: "best",
        reason: "engineBest",
        centipawnLoss: 0,
      },
      before: "+0.20",
      after: "+0.20",
      whiteAfter: "+0.20",
      bestMoveSan: "e4",
      principalVariationSan: ["e4", "e5", "Nf3", "Nc6", "Bb5", "a6", "Ba4"],
      lineStatus: "available",
      tip: "repeatProcess",
    },
  };
}

describe("Codex adviser request", () => {
  it("includes only bounded tactical facts and omits score-loss prose inputs", () => {
    const { game, insight } = fixture();
    const request = buildCodexAdviceRequest(game, insight, "fr");
    expect(request).toEqual({
      language: "fr",
      fenBefore: game.positions[0],
      fenAfter: game.positions[1],
      san: "e4",
      color: "white",
      result: "1-0",
      classification: "best",
      bestMoveSan: "e4",
      principalVariationSan: ["e4", "e5", "Nf3", "Nc6", "Bb5", "a6"],
    });
    const serialized = JSON.stringify(request);
    expect(serialized).not.toContain("Private White");
    expect(serialized).not.toContain("Private Black");
    expect(serialized).not.toContain("Private PGN");
    expect(serialized).not.toContain("private-user");
    expect(serialized).not.toContain("private-fingerprint");
    expect(serialized).not.toContain("centipawnLoss");
    expect(serialized).not.toContain("before");
    expect(serialized).not.toContain("after");
  });

  it("rejects missing lines, unrated moves, and unfinished games", () => {
    const { game, insight } = fixture();
    expect(buildCodexAdviceRequest(game, { ...insight, bestMoveSan: null }, "en")).toBeNull();
    expect(buildCodexAdviceRequest(game, { ...insight, principalVariationSan: [], lineStatus: "missing" }, "en")).toBeNull();
    expect(buildCodexAdviceRequest(game, {
      ...insight,
      rating: { ...insight.rating, classification: "notRated", centipawnLoss: null },
    }, "en")).toBeNull();
    expect(buildCodexAdviceRequest({ ...game, result: "*" }, insight, "en")).toBeNull();
  });

  it("versions and fingerprints advice by game, position, language, cache, and request", () => {
    const { game, insight } = fixture();
    const request = buildCodexAdviceRequest(game, insight, "en");
    const first = buildCodexAdviceIdentity(game.fingerprint, 1, "cache-a", request);
    const same = buildCodexAdviceIdentity(game.fingerprint, 1, "cache-a", request);
    const french = buildCodexAdviceIdentity(
      game.fingerprint,
      1,
      "cache-a",
      buildCodexAdviceRequest(game, insight, "fr"),
    );
    const changedCache = buildCodexAdviceIdentity(game.fingerprint, 1, "cache-b", request);
    const changedFacts = buildCodexAdviceIdentity(
      game.fingerprint,
      1,
      "cache-a",
      request ? { ...request, bestMoveSan: "d4" } : null,
    );

    expect(first).toMatchObject({
      gameFingerprint: game.fingerprint,
      positionIndex: 1,
      language: "en",
      promptVersion: CODEX_PROMPT_VERSION,
      schemaVersion: CODEX_SCHEMA_VERSION,
    });
    expect(same).toEqual(first);
    expect(codexAdviceIdentityKey(french)).not.toBe(codexAdviceIdentityKey(first));
    expect(codexAdviceIdentityKey(changedCache)).not.toBe(codexAdviceIdentityKey(first));
    expect(codexAdviceIdentityKey(changedFacts)).not.toBe(codexAdviceIdentityKey(first));
  });

  it("normalizes command errors without exposing arbitrary objects", () => {
    expect(codexErrorCode("codex_timeout")).toBe("codex_timeout");
    expect(codexErrorCode(new Error("codex_busy"))).toBe("codex_busy");
    expect(codexErrorCode({ secret: "hidden" })).toBe("codex_execution_failed");
  });
});
