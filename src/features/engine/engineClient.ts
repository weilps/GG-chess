import { invoke, isTauri } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/plugin-dialog";
import type {
  AnalysisProfile,
  EngineInfo,
  PositionEvaluation,
} from "../../types";

export const ANALYSIS_PROFILES = [
  { id: "quick", depth: 12 },
  { id: "balanced", depth: 18 },
  { id: "deep", depth: 22 },
] as const satisfies readonly AnalysisProfile[];

export interface AnalysisProgress {
  analysisId: string;
  current: number;
  total: number;
  evaluation: PositionEvaluation;
}

export interface AnalyzeResponse {
  evaluations: PositionEvaluation[];
  cancelled: boolean;
}

export function engineAvailable(): boolean {
  return isTauri();
}

export async function detectStockfish(): Promise<EngineInfo | null> {
  return invoke<EngineInfo | null>("detect_stockfish");
}

export async function validateEngine(path: string): Promise<EngineInfo> {
  return invoke<EngineInfo>("validate_engine", { path });
}

export async function selectEnginePath(): Promise<string | null> {
  const selected = await open({
    multiple: false,
    directory: false,
    filters: [{ name: "UCI chess engine", extensions: ["exe"] }],
  });
  return typeof selected === "string" ? selected : null;
}

export async function subscribeToAnalysisProgress(
  handler: (progress: AnalysisProgress) => void,
): Promise<UnlistenFn> {
  return listen<AnalysisProgress>("analysis-progress", (event) => handler(event.payload));
}

export async function analyzePositions(request: {
  analysisId: string;
  enginePath: string;
  gameResult: string;
  depth: number;
  positions: string[];
  positionIndexes: number[];
}): Promise<AnalyzeResponse> {
  return invoke<AnalyzeResponse>("analyze_game", { request });
}

export async function cancelAnalysis(analysisId: string): Promise<boolean> {
  return invoke<boolean>("cancel_analysis", { analysisId });
}

export function formatEvaluation(evaluation: PositionEvaluation | undefined): string {
  if (!evaluation) return "—";
  if (evaluation.mate !== null) {
    const prefix = evaluation.mate < 0 ? "-M" : "M";
    return `${prefix}${Math.abs(evaluation.mate)}`;
  }
  if (evaluation.scoreCp === null) return "—";
  const pawns = evaluation.scoreCp / 100;
  return `${pawns >= 0 ? "+" : ""}${pawns.toFixed(2)}`;
}

export function engineErrorCode(error: unknown): string {
  if (typeof error === "string") return error;
  if (error instanceof Error) return error.message;
  return "engine_unknown";
}
