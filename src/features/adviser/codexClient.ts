import { invoke, isTauri } from "@tauri-apps/api/core";
import type { CodexAdviceIdentity } from "../../lib/db/gameRepository";
import type { Language, StoredGame } from "../../types";
import type { CoachInsight } from "../coach/coachInsight";

export const CODEX_PROMPT_VERSION = 2;
export const CODEX_SCHEMA_VERSION = 2;

export interface CodexAdviceRequest {
  language: Language;
  fenBefore: string;
  fenAfter: string;
  san: string;
  color: "white" | "black";
  result: "1-0" | "0-1" | "1/2-1/2";
  classification: string;
  bestMoveSan: string;
  principalVariationSan: string[];
}

export interface CodexAdvice {
  plan: string;
}

export interface CodexAdviceResponse {
  schemaVersion: number;
  advice: CodexAdvice;
  model: string;
  reasoning: string;
  durationMs: number;
}

type CompletedResult = CodexAdviceRequest["result"];

function requestFingerprint(value: string): string {
  let hash = 0xcbf29ce484222325n;
  for (const character of value) {
    hash ^= BigInt(character.codePointAt(0) ?? 0);
    hash = BigInt.asUintN(64, hash * 0x100000001b3n);
  }
  return hash.toString(16).padStart(16, "0");
}

export function buildCodexAdviceIdentity(
  gameFingerprint: string,
  positionIndex: number,
  analysisCacheKey: string | null,
  request: CodexAdviceRequest | null,
): CodexAdviceIdentity | null {
  if (!analysisCacheKey || !request) return null;
  return {
    gameFingerprint,
    positionIndex,
    language: request.language,
    analysisFingerprint: requestFingerprint(`${analysisCacheKey}\u0000${JSON.stringify(request)}`),
    promptVersion: CODEX_PROMPT_VERSION,
    schemaVersion: CODEX_SCHEMA_VERSION,
  };
}

export function codexAdviceIdentityKey(identity: CodexAdviceIdentity | null): string {
  return identity
    ? [
      identity.gameFingerprint,
      identity.positionIndex,
      identity.language,
      identity.analysisFingerprint,
      identity.promptVersion,
      identity.schemaVersion,
    ].join("\u0000")
    : "codex-unavailable";
}

export function buildCodexAdviceRequest(
  game: Pick<StoredGame, "positions" | "result">,
  insight: CoachInsight | null,
  language: Language,
): CodexAdviceRequest | null {
  if (
    !insight
    || insight.rating.classification === "notRated"
    || !insight.bestMoveSan
    || insight.lineStatus !== "available"
    || insight.principalVariationSan.length === 0
    || !["1-0", "0-1", "1/2-1/2"].includes(game.result)
  ) {
    return null;
  }
  const fenBefore = game.positions[insight.rating.moveIndex];
  const fenAfter = game.positions[insight.rating.positionIndex];
  if (!fenBefore || !fenAfter) return null;

  return {
    language,
    fenBefore,
    fenAfter,
    san: insight.rating.san,
    color: insight.rating.color,
    result: game.result as CompletedResult,
    classification: insight.rating.classification,
    bestMoveSan: insight.bestMoveSan,
    principalVariationSan: insight.principalVariationSan.slice(0, 6),
  };
}

export function codexAdviserAvailable(): boolean {
  return isTauri();
}

export async function requestCodexAdvice(
  request: CodexAdviceRequest,
): Promise<CodexAdviceResponse> {
  return invoke<CodexAdviceResponse>("request_codex_advice", { request });
}

export function codexErrorCode(error: unknown): string {
  if (typeof error === "string") return error;
  if (error instanceof Error) return error.message;
  return "codex_execution_failed";
}
