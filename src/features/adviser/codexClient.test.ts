import { Chess } from "chess.js";
import { describe, expect, it } from "vitest";
import type { StoredGame } from "../../types";
import type { CoachInsight } from "../coach/coachInsight";
import { buildCodexAdviceRequest, codexErrorCode } from "./codexClient";

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
      bestMoveSan: "e4",
      principalVariationSan: ["e4", "e5", "Nf3", "Nc6", "Bb5", "a6", "Ba4"],
      lineStatus: "available",
      tip: "repeatProcess",
    },
  };
}

describe("Codex adviser request", () => {
  it("includes only the selected move's bounded facts", () => {
    const { game, insight } = fixture();
    const request = buildCodexAdviceRequest(game, insight, "fr");
    expect(request).toMatchObject({
      language: "fr",
      san: "e4",
      color: "white",
      result: "1-0",
      classification: "best",
      reason: "engineBest",
      centipawnLoss: 0,
      before: "+0.20",
      after: "+0.20",
      bestMoveSan: "e4",
      principalVariationSan: ["e4", "e5", "Nf3", "Nc6", "Bb5", "a6"],
    });
    const serialized = JSON.stringify(request);
    expect(serialized).not.toContain("Private White");
    expect(serialized).not.toContain("Private Black");
    expect(serialized).not.toContain("Private PGN");
    expect(serialized).not.toContain("private-user");
    expect(serialized).not.toContain("private-fingerprint");
  });

  it("rejects incomplete, unrated, and unfinished contexts", () => {
    const { game, insight } = fixture();
    expect(buildCodexAdviceRequest(game, { ...insight, before: null }, "en")).toBeNull();
    expect(buildCodexAdviceRequest(game, {
      ...insight,
      rating: { ...insight.rating, classification: "notRated", centipawnLoss: null },
    }, "en")).toBeNull();
    expect(buildCodexAdviceRequest({ ...game, result: "*" }, insight, "en")).toBeNull();
  });

  it("normalizes command errors without exposing arbitrary objects", () => {
    expect(codexErrorCode("codex_timeout")).toBe("codex_timeout");
    expect(codexErrorCode(new Error("codex_busy"))).toBe("codex_busy");
    expect(codexErrorCode({ secret: "hidden" })).toBe("codex_execution_failed");
  });
});
