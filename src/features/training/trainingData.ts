import { Chess } from "chess.js";
import type {
  MoveClassification,
  MoveClassificationId,
  StoredGame,
} from "../../types";
import type {
  PuzzleProgress,
  PuzzleResult,
  StoredAnalysisCache,
  TrainingActivity,
  TrainingActivityKind,
} from "../../lib/db/gameRepository";
import {
  calculateGameAccuracy,
  classifyGameMoves,
  moveToUci,
} from "../classification/classifyMoves";
import {
  convertPrincipalVariation,
  uciMoveToSan,
} from "../coach/coachInsight";

export type CoachProfileId = "calm" | "tactical" | "playful";
export type PlayerSide = "white" | "black";
export type PuzzleGrade = "again" | "good" | "easy";

const PROBLEM_RATINGS = new Set<MoveClassificationId>([
  "inaccuracy",
  "mistake",
  "miss",
  "blunder",
]);

const SEVERITY: Record<MoveClassificationId, number> = {
  brilliant: 0,
  great: 0,
  best: 0,
  excellent: 0,
  good: 0,
  inaccuracy: 1,
  mistake: 2,
  miss: 3,
  blunder: 4,
  notRated: 0,
};

export interface TrainingPuzzle {
  key: string;
  gameFingerprint: string;
  moveIndex: number;
  fen: string;
  color: PlayerSide;
  playedMoveSan: string;
  bestMoveUci: string;
  bestMoveSan: string;
  principalVariationSan: string[];
  rating: MoveClassification;
  playedAt: string;
  engineName: string;
  engineVersion: string;
  profile: StoredAnalysisCache["profile"];
  gameLabel: string;
}

export interface PuzzleMoveResult {
  legal: boolean;
  correct: boolean;
  uci: string | null;
  san: string | null;
  resultingFen: string | null;
}

export interface QuestProgress {
  kind: TrainingActivityKind;
  progress: number;
  target: number;
  completed: boolean;
}

export interface TrendWindow {
  games: number;
  scorePercent: number | null;
  accuracy: number | null;
  problemRate: number | null;
}

export interface PlayerTrends {
  recent: TrendWindow;
  previous: TrendWindow;
  insufficientComparison: boolean;
}

export interface OpeningLine {
  key: string;
  color: PlayerSide;
  moves: string[];
  games: number;
  wins: number;
  draws: number;
  losses: number;
  scorePercent: number;
  accuracy: number | null;
  problems: number;
}

interface PlayerGameFacts {
  game: StoredGame;
  side: PlayerSide;
  ratings: MoveClassification[];
  accuracy: number | null;
  problems: number;
  score: number;
}

export function parsePlayerAliases(value: string): string[] {
  return [...new Set(
    value
      .split(",")
      .map((alias) => alias.trim().toLocaleLowerCase())
      .filter(Boolean),
  )];
}

export function findPlayerSide(
  game: Pick<StoredGame, "white" | "black">,
  aliases: string[],
): PlayerSide | null {
  const white = aliases.includes(game.white.trim().toLocaleLowerCase());
  const black = aliases.includes(game.black.trim().toLocaleLowerCase());
  if (white === black) return null;
  return white ? "white" : "black";
}

export function buildTrainingPuzzles(
  games: StoredGame[],
  caches: StoredAnalysisCache[],
): TrainingPuzzle[] {
  const gamesByFingerprint = new Map(games.map((game) => [game.fingerprint, game]));
  const puzzles: TrainingPuzzle[] = [];
  for (const cache of caches) {
    const game = gamesByFingerprint.get(cache.gameFingerprint);
    if (
      !game
      || !["1-0", "0-1", "1/2-1/2"].includes(game.result)
      || !isCompleteAnalysisCache(game, cache)
    ) continue;
    const evaluations = new Map(
      cache.evaluations.map((evaluation) => [evaluation.positionIndex, evaluation]),
    );
    for (const rating of classifyGameMoves(game, cache.evaluations)) {
      if (!PROBLEM_RATINGS.has(rating.classification)) continue;
      const before = evaluations.get(rating.moveIndex);
      const fen = game.positions[rating.moveIndex];
      if (!before?.bestMove || !fen) continue;
      const bestMoveSan = uciMoveToSan(fen, before.bestMove);
      if (!bestMoveSan) continue;
      const line = convertPrincipalVariation(fen, before.pv);
      const key = [
        game.fingerprint,
        rating.moveIndex,
        cache.engineName,
        cache.engineVersion,
        cache.profile,
      ].join("|");
      puzzles.push({
        key,
        gameFingerprint: game.fingerprint,
        moveIndex: rating.moveIndex,
        fen,
        color: rating.color,
        playedMoveSan: rating.san,
        bestMoveUci: before.bestMove,
        bestMoveSan,
        principalVariationSan: line.status === "available" ? line.san : [],
        rating,
        playedAt: game.playedAt ?? game.importedAt,
        engineName: cache.engineName,
        engineVersion: cache.engineVersion,
        profile: cache.profile,
        gameLabel: `${game.white} – ${game.black}`,
      });
    }
  }
  return puzzles;
}

export function promotionChoices(
  fen: string,
  sourceSquare: string,
  targetSquare: string,
): string[] {
  try {
    return [...new Set(
      new Chess(fen)
        .moves({ verbose: true })
        .filter((move) => move.from === sourceSquare && move.to === targetSquare)
        .flatMap((move) => move.promotion ? [move.promotion] : []),
    )];
  } catch {
    return [];
  }
}

export function checkPuzzleMove(
  puzzle: Pick<TrainingPuzzle, "fen" | "bestMoveUci">,
  sourceSquare: string,
  targetSquare: string,
  promotion?: string,
): PuzzleMoveResult {
  try {
    const chess = new Chess(puzzle.fen);
    const move = chess.move({
      from: sourceSquare,
      to: targetSquare,
      ...(promotion ? { promotion } : {}),
    });
    const uci = moveToUci(move);
    return {
      legal: true,
      correct: uci === puzzle.bestMoveUci,
      uci,
      san: move.san,
      resultingFen: chess.fen(),
    };
  } catch {
    return { legal: false, correct: false, uci: null, san: null, resultingFen: null };
  }
}

export function updatePuzzleProgress(
  previous: PuzzleProgress | undefined,
  puzzleKey: string,
  result: PuzzleResult,
  now: Date,
): PuzzleProgress {
  const days = result === "easy" ? 7 : result === "good" ? 3 : result === "again" || result === "revealed" ? 1 : 0;
  const due = days === 0 && previous
    ? new Date(previous.dueAt)
    : addLocalDays(now, days);
  return {
    puzzleKey,
    attempts: (previous?.attempts ?? 0) + 1,
    successes: (previous?.successes ?? 0) + (["again", "good", "easy"].includes(result) ? 1 : 0),
    lastResult: result,
    dueAt: due.toISOString(),
    updatedAt: now.toISOString(),
  };
}

export function orderRevengePuzzles(
  puzzles: TrainingPuzzle[],
  progress: PuzzleProgress[],
  now: Date,
): TrainingPuzzle[] {
  const byKey = new Map(progress.map((item) => [item.puzzleKey, item]));
  return [...puzzles].sort((left, right) => {
    const leftProgress = byKey.get(left.key);
    const rightProgress = byKey.get(right.key);
    const leftDue = !leftProgress || new Date(leftProgress.dueAt) <= now;
    const rightDue = !rightProgress || new Date(rightProgress.dueAt) <= now;
    if (leftDue !== rightDue) return leftDue ? -1 : 1;
    if (!leftDue && leftProgress && rightProgress) {
      const dueDifference = leftProgress.dueAt.localeCompare(rightProgress.dueAt);
      if (dueDifference !== 0) return dueDifference;
    }
    const dateDifference = left.playedAt.localeCompare(right.playedAt);
    if (dateDifference !== 0) return dateDifference;
    return SEVERITY[right.rating.classification] - SEVERITY[left.rating.classification];
  });
}

export function localDay(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function weekStartMonday(date: Date): string {
  const monday = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const offset = (monday.getDay() + 6) % 7;
  monday.setDate(monday.getDate() - offset);
  return localDay(monday);
}

export function makeTrainingActivity(
  kind: TrainingActivityKind,
  itemKey: string,
  now: Date,
): TrainingActivity {
  return {
    weekStart: weekStartMonday(now),
    kind,
    itemKey,
    occurredOn: localDay(now),
    createdAt: now.toISOString(),
  };
}

export function buildQuestProgress(
  activities: TrainingActivity[],
  activeWeek: string,
): QuestProgress[] {
  const targets: Record<TrainingActivityKind, number> = {
    review: 3,
    puzzle: 5,
    opening: 3,
  };
  return (["review", "puzzle", "opening"] as const).map((kind) => {
    const progress = new Set(
      activities
        .filter((activity) => activity.weekStart === activeWeek && activity.kind === kind)
        .map((activity) => activity.itemKey),
    ).size;
    return { kind, progress, target: targets[kind], completed: progress >= targets[kind] };
  });
}

export function calculateTrainingStreak(days: string[], now = new Date()): number {
  const unique = [...new Set(days)].sort().reverse();
  if (unique.length === 0) return 0;
  const yesterday = addLocalDays(now, -1);
  if (unique[0] !== localDay(now) && unique[0] !== localDay(yesterday)) return 0;
  let streak = 1;
  let cursor = localDateFromDay(unique[0]);
  for (const day of unique.slice(1)) {
    const expected = addLocalDays(cursor, -1);
    if (localDay(expected) !== day) break;
    streak += 1;
    cursor = expected;
  }
  return streak;
}

export function buildPlayerTrends(
  games: StoredGame[],
  caches: StoredAnalysisCache[],
  aliases: string[],
): PlayerTrends {
  const facts = buildPlayerFacts(games, caches, aliases)
    .filter((item) => item.ratings.some((rating) => rating.classification !== "notRated"))
    .sort((left, right) => (
      (right.game.playedAt ?? right.game.importedAt)
        .localeCompare(left.game.playedAt ?? left.game.importedAt)
    ));
  const recent = facts.slice(0, 5);
  const previous = facts.slice(5, 10);
  return {
    recent: summarizeTrend(recent),
    previous: summarizeTrend(previous),
    insufficientComparison: recent.length < 5 || previous.length < 5,
  };
}

export function buildOpeningRepertoire(
  games: StoredGame[],
  caches: StoredAnalysisCache[],
  aliases: string[],
): OpeningLine[] {
  const groups = new Map<string, PlayerGameFacts[]>();
  for (const facts of buildPlayerFacts(games, caches, aliases)) {
    if (facts.game.moves.length === 0) continue;
    const moves = facts.game.moves.slice(0, 4);
    const key = `${facts.side}:${moves.join(" ")}`;
    const group = groups.get(key) ?? [];
    group.push(facts);
    groups.set(key, group);
  }
  return [...groups.entries()]
    .map(([key, facts]) => {
      const scores = facts.map((item) => item.score);
      const accuracies = facts
        .map((item) => item.accuracy)
        .filter((value): value is number => value !== null);
      return {
        key,
        color: facts[0].side,
        moves: facts[0].game.moves.slice(0, 4),
        games: facts.length,
        wins: scores.filter((score) => score === 1).length,
        draws: scores.filter((score) => score === 0.5).length,
        losses: scores.filter((score) => score === 0).length,
        scorePercent: round(scores.reduce((sum, score) => sum + score, 0) / scores.length * 100),
        accuracy: accuracies.length
          ? round(accuracies.reduce((sum, value) => sum + value, 0) / accuracies.length)
          : null,
        problems: facts.reduce((sum, item) => sum + item.problems, 0),
      };
    })
    .sort((left, right) => right.games - left.games || left.key.localeCompare(right.key));
}

function buildPlayerFacts(
  games: StoredGame[],
  caches: StoredAnalysisCache[],
  aliases: string[],
): PlayerGameFacts[] {
  const latestCache = latestCacheByGame(caches);
  return games.flatMap((game) => {
    if (!["1-0", "0-1", "1/2-1/2"].includes(game.result)) return [];
    const side = findPlayerSide(game, aliases);
    if (!side) return [];
    const cache = latestCache.get(game.fingerprint);
    const ratings = cache ? classifyGameMoves(game, cache.evaluations) : [];
    const accuracy = calculateGameAccuracy(ratings)[side];
    const problems = ratings.filter(
      (rating) => rating.color === side && PROBLEM_RATINGS.has(rating.classification),
    ).length;
    return [{ game, side, ratings, accuracy, problems, score: playerScore(game.result, side) }];
  });
}

function latestCacheByGame(caches: StoredAnalysisCache[]): Map<string, StoredAnalysisCache> {
  const latest = new Map<string, StoredAnalysisCache>();
  for (const cache of caches) {
    const existing = latest.get(cache.gameFingerprint);
    if (!existing || cache.analyzedAt > existing.analyzedAt) {
      latest.set(cache.gameFingerprint, cache);
    }
  }
  return latest;
}

function isCompleteAnalysisCache(
  game: StoredGame,
  cache: StoredAnalysisCache,
): boolean {
  if (game.positions.length !== game.moves.length + 1) return false;
  if (cache.evaluations.length !== game.positions.length) return false;
  const indexes = new Set<number>();
  for (const evaluation of cache.evaluations) {
    if (
      evaluation.gameFingerprint !== cache.gameFingerprint
      || evaluation.engineName !== cache.engineName
      || evaluation.engineVersion !== cache.engineVersion
      || evaluation.profile !== cache.profile
      || evaluation.positionIndex < 0
      || evaluation.positionIndex >= game.positions.length
      || indexes.has(evaluation.positionIndex)
    ) return false;
    indexes.add(evaluation.positionIndex);
  }
  return indexes.size === game.positions.length;
}

function summarizeTrend(facts: PlayerGameFacts[]): TrendWindow {
  if (facts.length === 0) {
    return { games: 0, scorePercent: null, accuracy: null, problemRate: null };
  }
  const accuracies = facts
    .map((item) => item.accuracy)
    .filter((value): value is number => value !== null);
  const playerRatings = facts.flatMap((item) => (
    item.ratings.filter((rating) => rating.color === item.side && rating.classification !== "notRated")
  ));
  const problems = playerRatings.filter((rating) => PROBLEM_RATINGS.has(rating.classification));
  return {
    games: facts.length,
    scorePercent: round(facts.reduce((sum, item) => sum + item.score, 0) / facts.length * 100),
    accuracy: accuracies.length
      ? round(accuracies.reduce((sum, value) => sum + value, 0) / accuracies.length)
      : null,
    problemRate: playerRatings.length ? round(problems.length / playerRatings.length * 100) : null,
  };
}

function playerScore(result: string, side: PlayerSide): number {
  if (result === "1/2-1/2") return 0.5;
  if ((result === "1-0" && side === "white") || (result === "0-1" && side === "black")) {
    return 1;
  }
  return 0;
}

function addLocalDays(date: Date, days: number): Date {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
}

function localDateFromDay(day: string): Date {
  const [year, month, date] = day.split("-").map(Number);
  return new Date(year, month - 1, date, 12);
}

function round(value: number): number {
  return Math.round(value * 10) / 10;
}
