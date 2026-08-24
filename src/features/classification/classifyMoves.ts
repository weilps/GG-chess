import { BLACK, Chess, WHITE, type Color, type Move, type PieceSymbol } from "chess.js";
import type {
  GameAccuracy,
  MoveClassification,
  MoveClassificationId,
  MoveClassificationReason,
  PositionEvaluation,
  StoredGame,
} from "../../types";

const MATE_CP = 100_000;
const PIECE_VALUE: Record<PieceSymbol, number> = {
  p: 1,
  n: 3,
  b: 3,
  r: 5,
  q: 9,
  k: 100,
};

export interface ClassificationFacts {
  centipawnLoss: number;
  isBestMove: boolean;
  isSoundSacrifice: boolean;
  foundMate: boolean;
  recoveredPosition: boolean;
  missedWin: boolean;
}

export interface ClassificationDecision {
  classification: Exclude<MoveClassificationId, "notRated">;
  reason: Exclude<MoveClassificationReason, "missingEvaluation" | "invalidMove">;
}

function mateScore(mate: number, gameResult: string): number {
  if (mate === 0) {
    if (gameResult === "1-0") return MATE_CP;
    if (gameResult === "0-1") return -MATE_CP;
    return 0;
  }
  const distancePenalty = Math.min(Math.abs(mate), 100) * 100;
  return Math.sign(mate) * (MATE_CP - distancePenalty);
}

export function evaluationToWhiteCentipawns(
  evaluation: PositionEvaluation,
  gameResult: string,
): number {
  if (evaluation.mate !== null) return mateScore(evaluation.mate, gameResult);
  return evaluation.scoreCp ?? 0;
}

export function playedMoveFromSan(fen: string, san: string): Move | null {
  try {
    return new Chess(fen).move(san, { strict: false });
  } catch {
    return null;
  }
}

export function moveToUci(move: Move): string {
  return `${move.from}${move.to}${move.promotion ?? ""}`;
}

function offersSoundMaterial(
  move: Move,
  afterFen: string,
  moverEvaluation: number,
): boolean {
  const movedValue = PIECE_VALUE[move.piece];
  if (movedValue < 3 || moverEvaluation < -50) return false;
  try {
    const after = new Chess(afterFen);
    const opponent: Color = move.color === WHITE ? BLACK : WHITE;
    const attackerValues = after.attackers(move.to, opponent)
      .map((square) => after.get(square))
      .filter((piece): piece is NonNullable<typeof piece> => piece !== undefined)
      .map((piece) => PIECE_VALUE[piece.type]);
    return attackerValues.some((attackerValue) => attackerValue < movedValue);
  } catch {
    return false;
  }
}

export function classifyFromFacts(facts: ClassificationFacts): ClassificationDecision {
  if (facts.isBestMove && facts.isSoundSacrifice && facts.centipawnLoss <= 15) {
    return { classification: "brilliant", reason: "brilliantSacrifice" };
  }
  if (facts.isBestMove && facts.foundMate) {
    return { classification: "great", reason: "greatMate" };
  }
  if (facts.isBestMove && facts.recoveredPosition) {
    return { classification: "great", reason: "greatRecovery" };
  }
  if (facts.isBestMove) {
    return { classification: "best", reason: "engineBest" };
  }
  if (facts.missedWin) {
    return { classification: "miss", reason: "missedWin" };
  }
  if (facts.centipawnLoss <= 15) {
    return { classification: "excellent", reason: "centipawnLoss" };
  }
  if (facts.centipawnLoss <= 50) {
    return { classification: "good", reason: "centipawnLoss" };
  }
  if (facts.centipawnLoss <= 100) {
    return { classification: "inaccuracy", reason: "centipawnLoss" };
  }
  if (facts.centipawnLoss <= 200) {
    return { classification: "mistake", reason: "centipawnLoss" };
  }
  return { classification: "blunder", reason: "centipawnLoss" };
}

function notRated(
  moveIndex: number,
  san: string,
  reason: "missingEvaluation" | "invalidMove",
): MoveClassification {
  return {
    moveIndex,
    positionIndex: moveIndex + 1,
    color: moveIndex % 2 === 0 ? "white" : "black",
    san,
    uci: null,
    classification: "notRated",
    reason,
    centipawnLoss: null,
  };
}

export function classifyGameMoves(
  game: Pick<StoredGame, "moves" | "positions" | "result">,
  evaluations: PositionEvaluation[],
): MoveClassification[] {
  const byPosition = new Map(evaluations.map((evaluation) => [evaluation.positionIndex, evaluation]));
  return game.moves.map((san, moveIndex) => {
    const before = byPosition.get(moveIndex);
    const after = byPosition.get(moveIndex + 1);
    if (!before || !after) return notRated(moveIndex, san, "missingEvaluation");
    const playedMove = playedMoveFromSan(game.positions[moveIndex], san);
    if (!playedMove) return notRated(moveIndex, san, "invalidMove");

    const moverSign = moveIndex % 2 === 0 ? 1 : -1;
    const beforeMover = moverSign * evaluationToWhiteCentipawns(before, game.result);
    const afterMover = moverSign * evaluationToWhiteCentipawns(after, game.result);
    const centipawnLoss = Math.max(0, beforeMover - afterMover);
    const uci = moveToUci(playedMove);
    const isBestMove = before.bestMove === uci;
    const beforeMate = before.mate !== null && moverSign * before.mate > 0;
    const afterMate = after.mate !== null
      && (after.mate === 0
        ? (game.result === "1-0" ? moverSign > 0 : game.result === "0-1" && moverSign < 0)
        : moverSign * after.mate > 0);
    const decision = classifyFromFacts({
      centipawnLoss,
      isBestMove,
      isSoundSacrifice: isBestMove
        && offersSoundMaterial(playedMove, game.positions[moveIndex + 1], afterMover),
      foundMate: afterMate && !beforeMate,
      recoveredPosition: beforeMover <= -150 && afterMover >= -50,
      missedWin: (beforeMover >= 250 || beforeMate) && afterMover < 75 && !afterMate,
    });
    return {
      moveIndex,
      positionIndex: moveIndex + 1,
      color: moveIndex % 2 === 0 ? "white" : "black",
      san,
      uci,
      ...decision,
      centipawnLoss,
    };
  });
}

function sideAccuracy(ratings: MoveClassification[]): number | null {
  const rated = ratings.filter((rating) => rating.centipawnLoss !== null);
  if (rated.length === 0) return null;
  const total = rated.reduce(
    (sum, rating) => sum + 100 * Math.exp(-(rating.centipawnLoss ?? 0) / 120),
    0,
  );
  return Math.round((total / rated.length) * 10) / 10;
}

export function calculateGameAccuracy(ratings: MoveClassification[]): GameAccuracy {
  return {
    white: sideAccuracy(ratings.filter((rating) => rating.color === "white")),
    black: sideAccuracy(ratings.filter((rating) => rating.color === "black")),
  };
}

export function formatCentipawnLoss(loss: number | null): string {
  if (loss === null) return "—";
  if (loss > 999) return "999+ cp";
  return `${Math.round(loss)} cp`;
}
