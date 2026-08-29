import type {
  GuidanceMode,
  MoveClassification,
  MultiPv,
  PositionEvaluation,
  RankedVariation,
  StoredGame,
} from "../../types";
import { playedMoveFromSan } from "../classification/classifyMoves";

export type BoardOrientation = "white" | "black";
export type GuidanceTone = "ranked" | "warning" | "blunder";

export interface GuidanceArrow {
  key: string;
  sourceSquare: string;
  targetSquare: string;
  tone: GuidanceTone;
  rank: MultiPv | null;
  evaluation: string | null;
  played: boolean;
  warningSymbol: "!" | "!!" | null;
}

export interface BoardGuidancePlan {
  boardPositionIndex: number;
  arrows: GuidanceArrow[];
}

interface BuildBoardGuidanceOptions {
  enabled: boolean;
  engineStatus: "loading" | "ready" | "missing" | "error";
  evaluations: PositionEvaluation[];
  game: StoredGame;
  loading: boolean;
  mode: GuidanceMode;
  multiPv: MultiPv;
  positionIndex: number;
  selectedRating: MoveClassification | null;
}

export interface BoardPoint {
  x: number;
  y: number;
}

const UCI_MOVE = /^([a-h][1-8])([a-h][1-8])[qrbn]?$/;
const WARNING_CLASSIFICATIONS = new Set(["inaccuracy", "mistake", "miss", "blunder"]);

function variationMove(variation: RankedVariation): { sourceSquare: string; targetSquare: string } | null {
  const match = UCI_MOVE.exec(variation.bestMove ?? variation.pv[0] ?? "");
  return match ? { sourceSquare: match[1], targetSquare: match[2] } : null;
}

export function formatGuidanceEvaluation(variation: RankedVariation): string {
  if (variation.mate !== null) {
    return `${variation.mate < 0 ? "-M" : "M"}${Math.abs(variation.mate)}`;
  }
  if (variation.scoreCp === null) return "—";
  const pawns = variation.scoreCp / 100;
  return `${pawns >= 0 ? "+" : ""}${pawns.toFixed(2)}`;
}

function playedArrow(
  game: StoredGame,
  positionIndex: number,
  selectedRating: MoveClassification | null,
): GuidanceArrow | null {
  if (positionIndex < 1 || !selectedRating || !WARNING_CLASSIFICATIONS.has(selectedRating.classification)) {
    return null;
  }
  const move = playedMoveFromSan(game.positions[positionIndex - 1], game.moves[positionIndex - 1]);
  if (!move) return null;
  const blunder = selectedRating.classification === "blunder";
  return {
    key: `played-${positionIndex}-${move.from}-${move.to}`,
    sourceSquare: move.from,
    targetSquare: move.to,
    tone: blunder ? "blunder" : "warning",
    rank: null,
    evaluation: null,
    played: true,
    warningSymbol: blunder ? "!!" : "!",
  };
}

export function buildBoardGuidance(options: BuildBoardGuidanceOptions): BoardGuidancePlan {
  const boardPositionIndex = options.mode === "compare" && options.positionIndex > 0
    ? options.positionIndex - 1
    : options.positionIndex;
  const empty = (): BoardGuidancePlan => ({ boardPositionIndex, arrows: [] });
  if (!options.enabled
    || options.positionIndex === 0
    || options.loading
    || options.engineStatus !== "ready") return empty();

  const evaluation = options.evaluations.find((item) => item.positionIndex === boardPositionIndex);
  if (!evaluation) return empty();
  const variations = [...evaluation.variations]
    .sort((left, right) => left.rank - right.rank)
    .filter((variation) => variation.rank <= options.multiPv);
  const expectedRanks = Array.from({ length: options.multiPv }, (_, index) => index + 1);
  if (variations.length !== options.multiPv
    || expectedRanks.some((rank, index) => variations[index]?.rank !== rank)) return empty();

  const arrows: GuidanceArrow[] = [];
  for (const variation of variations) {
    const move = variationMove(variation);
    if (!move) return empty();
    arrows.push({
      key: `rank-${variation.rank}-${move.sourceSquare}-${move.targetSquare}`,
      ...move,
      tone: "ranked",
      rank: variation.rank,
      evaluation: formatGuidanceEvaluation(variation),
      played: false,
      warningSymbol: null,
    });
  }

  const actual = playedArrow(options.game, options.positionIndex, options.selectedRating);
  if (!actual) return { boardPositionIndex, arrows };
  const duplicate = arrows.find(
    (arrow) => arrow.sourceSquare === actual.sourceSquare && arrow.targetSquare === actual.targetSquare,
  );
  if (duplicate) {
    duplicate.played = true;
    duplicate.warningSymbol = actual.warningSymbol;
    return { boardPositionIndex, arrows };
  }
  return { boardPositionIndex, arrows: [...arrows, actual] };
}

export function squareCenter(square: string, orientation: BoardOrientation): BoardPoint {
  const file = square.charCodeAt(0) - 97;
  const rank = Number(square[1]) - 1;
  if (orientation === "white") {
    return { x: file * 100 + 50, y: (7 - rank) * 100 + 50 };
  }
  return { x: (7 - file) * 100 + 50, y: rank * 100 + 50 };
}
