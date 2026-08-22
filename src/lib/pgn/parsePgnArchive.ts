import { Chess } from "chess.js";
import type {
  ImportRejection,
  ParsedGame,
  ParseReport,
} from "../../types";

const STANDARD_VARIANTS = new Set(["", "standard", "chess"]);

function splitIntoCandidateGames(input: string): string[] {
  const text = input.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n").trim();
  if (!text) {
    return [];
  }

  const eventStarts = [...text.matchAll(/^\s*\[Event\s+/gim)].map(
    (match) => match.index ?? 0,
  );
  if (eventStarts.length <= 1) {
    return [text];
  }

  const chunks: string[] = [];
  if (eventStarts[0] > 0 && text.slice(0, eventStarts[0]).trim()) {
    chunks.push(text.slice(0, eventStarts[0]).trim());
  }
  eventStarts.forEach((start, index) => {
    const end = eventStarts[index + 1] ?? text.length;
    const chunk = text.slice(start, end).trim();
    if (chunk) {
      chunks.push(chunk);
    }
  });
  return chunks;
}

function parsePlayedAt(headers: Record<string, string>): {
  playedAt: string | null;
  displayDate: string | null;
} {
  const dateHeader = headers.UTCDate ?? headers.Date;
  if (!dateHeader || !/^\d{4}\.\d{2}\.\d{2}$/.test(dateHeader)) {
    return { playedAt: null, displayDate: null };
  }

  const displayDate = dateHeader.replaceAll(".", "-");
  const timeHeader = headers.UTCTime;
  const time = timeHeader && /^\d{2}:\d{2}:\d{2}$/.test(timeHeader)
    ? timeHeader
    : "00:00:00";
  return { playedAt: `${displayDate}T${time}Z`, displayDate };
}

function fingerprintFor(canonical: string): string {
  let hash = 14_695_981_039_346_656_037n;
  const prime = 1_099_511_628_211n;
  for (const character of canonical) {
    hash ^= BigInt(character.codePointAt(0) ?? 0);
    hash = BigInt.asUintN(64, hash * prime);
  }
  return `game-${hash.toString(16).padStart(16, "0")}-${canonical.length}`;
}

function readTagBeforeMoveParsing(rawPgn: string, tagName: string): string {
  const escapedTagName = tagName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const tagPattern = new RegExp(
    `^\\s*\\[${escapedTagName}\\s+"((?:\\\\.|[^"\\\\])*)"\\]\\s*$`,
    "im",
  );
  const value = rawPgn.match(tagPattern)?.[1] ?? "";
  return value.replace(/\\"/g, '"').replace(/\\\\/g, "\\").trim();
}

function parseCandidate(
  rawPgn: string,
  gameNumber: number,
): { game?: ParsedGame; rejection?: ImportRejection } {
  try {
    // Variant-only notation may be invalid to the standard parser, so classify
    // an explicit non-standard variant before asking chess.js to parse moves.
    const declaredVariant = readTagBeforeMoveParsing(rawPgn, "Variant");
    if (!STANDARD_VARIANTS.has(declaredVariant.toLowerCase())) {
      return {
        rejection: {
          gameNumber,
          reason: "unsupportedVariant",
          detail: declaredVariant,
        },
      };
    }

    const chess = new Chess();
    chess.loadPgn(rawPgn, { strict: false });
    const headers = chess.getHeaders();
    const variant = (headers.Variant ?? "").trim();
    if (!STANDARD_VARIANTS.has(variant.toLowerCase())) {
      return {
        rejection: {
          gameNumber,
          reason: "unsupportedVariant",
          detail: variant,
        },
      };
    }

    const history = chess.history({ verbose: true });
    if (history.length === 0) {
      return { rejection: { gameNumber, reason: "invalidPgn" } };
    }

    const moves = history.map((move) => move.san);
    const positions = [history[0].before, ...history.map((move) => move.after)];
    const white = headers.White?.trim() || "?";
    const black = headers.Black?.trim() || "?";
    const result = headers.Result?.trim() || "*";
    const { playedAt, displayDate } = parsePlayedAt(headers);
    const canonical = [
      white.toLocaleLowerCase(),
      black.toLocaleLowerCase(),
      headers.Date ?? "",
      headers.Round ?? "",
      result,
      moves.join(" "),
    ].join("|");

    return {
      game: {
        fingerprint: fingerprintFor(canonical),
        white,
        black,
        result,
        playedAt,
        displayDate,
        timeControl: headers.TimeControl?.trim() || null,
        source: headers.Site?.trim() || null,
        rawPgn,
        moves,
        positions,
      },
    };
  } catch {
    return { rejection: { gameNumber, reason: "invalidPgn" } };
  }
}

export function parsePgnArchive(input: string): ParseReport {
  const candidates = splitIntoCandidateGames(input);
  if (candidates.length === 0) {
    return {
      games: [],
      rejections: [{ gameNumber: 1, reason: "emptyFile" }],
    };
  }

  const games: ParsedGame[] = [];
  const rejections: ImportRejection[] = [];
  candidates.forEach((candidate, index) => {
    const parsed = parseCandidate(candidate, index + 1);
    if (parsed.game) {
      games.push(parsed.game);
    }
    if (parsed.rejection) {
      rejections.push(parsed.rejection);
    }
  });
  return { games, rejections };
}
