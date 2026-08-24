import { invoke, isTauri } from "@tauri-apps/api/core";
import type { Language, StoredGame } from "../../types";
import type { CoachInsight } from "../coach/coachInsight";

export interface CodexAdviceRequest {
  language: Language;
  fenBefore: string;
  fenAfter: string;
  san: string;
  color: "white" | "black";
  result: "1-0" | "0-1" | "1/2-1/2";
  classification: string;
  reason: string;
  centipawnLoss: number;
  before: string;
  after: string;
  bestMoveSan: string | null;
  principalVariationSan: string[];
}

export interface CodexAdvice {
  summary: string;
  explanation: string;
  plan: string;
  practice: string;
}

export interface CodexAdviceResponse {
  schemaVersion: number;
  advice: CodexAdvice;
  model: string;
  reasoning: string;
  durationMs: number;
}

type CompletedResult = CodexAdviceRequest["result"];

export function buildCodexAdviceRequest(
  game: Pick<StoredGame, "positions" | "result">,
  insight: CoachInsight | null,
  language: Language,
): CodexAdviceRequest | null {
  if (
    !insight
    || insight.rating.classification === "notRated"
    || insight.rating.centipawnLoss === null
    || insight.before === null
    || insight.after === null
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
    reason: insight.rating.reason,
    centipawnLoss: insight.rating.centipawnLoss,
    before: insight.before,
    after: insight.after,
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
