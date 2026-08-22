import { describe, expect, it } from "vitest";
import { parsePgnArchive } from "./parsePgnArchive";

const standardGame = `[Event "Training"]
[Site "https://example.test/game/1"]
[Date "2026.08.21"]
[White "Alice"]
[Black "Bob"]
[Result "1-0"]
[TimeControl "600+5"]

1. e4 e5 2. Nf3 Nc6 3. Bb5 a6 1-0`;

describe("parsePgnArchive", () => {
  it("parses a standard game and creates board positions", () => {
    const report = parsePgnArchive(standardGame);

    expect(report.rejections).toEqual([]);
    expect(report.games).toHaveLength(1);
    expect(report.games[0]).toMatchObject({
      white: "Alice",
      black: "Bob",
      result: "1-0",
      displayDate: "2026-08-21",
      timeControl: "600+5",
    });
    expect(report.games[0].moves).toEqual(["e4", "e5", "Nf3", "Nc6", "Bb5", "a6"]);
    expect(report.games[0].positions).toHaveLength(7);
  });

  it("imports valid games while reporting invalid and variant entries", () => {
    const invalidGame = `[Event "Broken"]
[White "Nope"]
[Black "Still nope"]

1. e9`;
    const chess960 = `[Event "Variant"]
[Variant "Chess960"]
[White "Carol"]
[Black "Dan"]
[Result "*"]

1. e4 e5 *`;

    const report = parsePgnArchive(
      `${standardGame}\n\n${invalidGame}\n\n${chess960}`,
    );

    expect(report.games).toHaveLength(1);
    expect(report.rejections).toEqual([
      { gameNumber: 2, reason: "invalidPgn" },
      { gameNumber: 3, reason: "unsupportedVariant", detail: "Chess960" },
    ]);
  });

  it("uses a stable fingerprint that ignores comments", () => {
    const annotated = standardGame.replace("1. e4", "1. e4 {A comment}");
    expect(parsePgnArchive(standardGame).games[0].fingerprint).toBe(
      parsePgnArchive(annotated).games[0].fingerprint,
    );
  });

  it("classifies variant-only notation before standard move parsing", () => {
    const crazyhouse = `[Event "Pocket game"]
[Variant "Crazyhouse"]
[FEN "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR[P] w KQkq - 0 1"]
[White "Pocket"]
[Black "Tester"]
[Result "*"]

1. P@e4 *`;

    expect(parsePgnArchive(crazyhouse)).toMatchObject({
      games: [],
      rejections: [
        { gameNumber: 1, reason: "unsupportedVariant", detail: "Crazyhouse" },
      ],
    });
  });

  it("reports an empty file", () => {
    expect(parsePgnArchive(" \n ").rejections).toEqual([
      { gameNumber: 1, reason: "emptyFile" },
    ]);
  });
});
