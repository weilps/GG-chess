import { Chess } from "chess.js";
import type {
  MoveClassification,
  PositionEvaluation,
  StoredGame,
} from "../../types";
import { evaluationToWhiteCentipawns } from "../classification/classifyMoves";

export type CoachTipId =
  | "scanAllChecks"
  | "calculateChecks"
  | "compareCaptures"
  | "forcingSafety"
  | "compareCandidates"
  | "repeatProcess"
  | "analyzeAdjacent";

export type CoachLineStatus = "available" | "missing" | "invalid";

export interface ConvertedPrincipalVariation {
  san: string[];
  status: CoachLineStatus;
  firstMoveGivesCheck: boolean;
  firstMoveCaptures: boolean;
}

export interface CoachInsight {
  rating: MoveClassification;
  before: string | null;
  after: string | null;
  whiteAfter: string | null;
  bestMoveSan: string | null;
  principalVariationSan: string[];
  lineStatus: CoachLineStatus;
  tip: CoachTipId;
}

interface UciMove {
  from: string;
  to: string;
  promotion?: string;
}

function parseUci(uci: string): UciMove | null {
  const match = /^([a-h][1-8])([a-h][1-8])([qrbn])?$/.exec(uci);
  if (!match) return null;
  return {
    from: match[1],
    to: match[2],
    ...(match[3] ? { promotion: match[3] } : {}),
  };
}

export function convertPrincipalVariation(
  fen: string,
  pv: string[],
  limit = 6,
): ConvertedPrincipalVariation {
  if (pv.length === 0) {
    return { san: [], status: "missing", firstMoveGivesCheck: false, firstMoveCaptures: false };
  }
  try {
    const chess = new Chess(fen);
    const san: string[] = [];
    let firstMoveGivesCheck = false;
    let firstMoveCaptures = false;
    for (const [index, uci] of pv.slice(0, limit).entries()) {
      const parsed = parseUci(uci);
      if (!parsed) throw new Error("invalid_uci");
      const move = chess.move(parsed);
      if (!move) throw new Error("illegal_uci");
      if (index === 0) {
        firstMoveGivesCheck = move.san.includes("+") || move.san.includes("#");
        firstMoveCaptures = move.captured !== undefined;
      }
      san.push(move.san);
    }
    return { san, status: "available", firstMoveGivesCheck, firstMoveCaptures };
  } catch {
    return { san: [], status: "invalid", firstMoveGivesCheck: false, firstMoveCaptures: false };
  }
}

export function uciMoveToSan(fen: string, uci: string | null): string | null {
  if (!uci) return null;
  try {
    const parsed = parseUci(uci);
    if (!parsed) return null;
    return new Chess(fen).move(parsed)?.san ?? null;
  } catch {
    return null;
  }
}

function moverSign(rating: MoveClassification): 1 | -1 {
  return rating.color === "white" ? 1 : -1;
}

export function formatMoverEvaluation(
  evaluation: PositionEvaluation,
  rating: MoveClassification,
  gameResult: string,
): string {
  const moverCp = moverSign(rating) * evaluationToWhiteCentipawns(evaluation, gameResult);
  if (evaluation.mate !== null) {
    return `${moverCp < 0 ? "-" : ""}M${Math.abs(evaluation.mate)}`;
  }
  const pawns = moverCp / 100;
  return `${pawns >= 0 ? "+" : ""}${pawns.toFixed(2)}`;
}

export function formatWhiteEvaluation(
  evaluation: PositionEvaluation,
  gameResult: string,
): string {
  const whiteCp = evaluationToWhiteCentipawns(evaluation, gameResult);
  if (evaluation.mate !== null) {
    return `${whiteCp < 0 ? "-" : ""}M${Math.abs(evaluation.mate)}`;
  }
  const pawns = whiteCp / 100;
  return `${pawns >= 0 ? "+" : ""}${pawns.toFixed(2)}`;
}

function moverHasMate(
  evaluation: PositionEvaluation,
  rating: MoveClassification,
  gameResult: string,
): boolean {
  return evaluation.mate !== null
    && moverSign(rating) * evaluationToWhiteCentipawns(evaluation, gameResult) > 0;
}

function selectTip(
  rating: MoveClassification,
  before: PositionEvaluation | undefined,
  after: PositionEvaluation | undefined,
  gameResult: string,
  line: ConvertedPrincipalVariation,
): CoachTipId {
  if (rating.classification === "notRated" || !before || !after) return "analyzeAdjacent";
  const foundMate = moverHasMate(after, rating, gameResult)
    && !moverHasMate(before, rating, gameResult);
  const missedMate = moverHasMate(before, rating, gameResult)
    && !moverHasMate(after, rating, gameResult);
  if (foundMate || missedMate || rating.reason === "greatMate") return "scanAllChecks";
  if (line.firstMoveGivesCheck) return "calculateChecks";
  if (line.firstMoveCaptures) return "compareCaptures";
  if (["miss", "blunder", "mistake"].includes(rating.classification)) return "forcingSafety";
  if (["inaccuracy", "good"].includes(rating.classification)) return "compareCandidates";
  return "repeatProcess";
}

export function buildCoachInsight(
  game: Pick<StoredGame, "moves" | "positions" | "result">,
  rating: MoveClassification,
  evaluations: PositionEvaluation[],
): CoachInsight {
  const byPosition = new Map(evaluations.map((evaluation) => [evaluation.positionIndex, evaluation]));
  const before = byPosition.get(rating.moveIndex);
  const after = byPosition.get(rating.positionIndex);
  const fen = game.positions[rating.moveIndex];
  const line = before && fen
    ? convertPrincipalVariation(fen, before.pv)
    : { san: [], status: "missing" as const, firstMoveGivesCheck: false, firstMoveCaptures: false };
  const bestMoveSan = before && fen ? uciMoveToSan(fen, before.bestMove) : null;
  const rated = rating.classification !== "notRated" && before !== undefined && after !== undefined;

  return {
    rating,
    before: rated ? formatMoverEvaluation(before, rating, game.result) : null,
    after: rated ? formatMoverEvaluation(after, rating, game.result) : null,
    whiteAfter: rated ? formatWhiteEvaluation(after, game.result) : null,
    bestMoveSan,
    principalVariationSan: line.san,
    lineStatus: line.status,
    tip: selectTip(rating, before, after, game.result, line),
  };
}
