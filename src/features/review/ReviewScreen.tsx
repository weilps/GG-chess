import { useEffect, useMemo, useState } from "react";
import { Chessboard } from "react-chessboard";
import type { TranslationKey } from "../../i18n/translations";
import type { GameRepository } from "../../lib/db/gameRepository";
import type { AnalysisSnapshot, Language, StoredGame } from "../../types";
import { buildCodexAdviceRequest } from "../adviser/codexClient";
import { CodexAdvisorPanel } from "../adviser/CodexAdvisorPanel";
import { calculateGameAccuracy, classifyGameMoves } from "../classification/classifyMoves";
import { MoveRatingBadge, MoveRatingDetail } from "../classification/MoveRatings";
import { CoachPanel } from "../coach/CoachPanel";
import { buildCoachInsight } from "../coach/coachInsight";
import { EnginePanel } from "../engine/EnginePanel";
import { EvaluationBar } from "./EvaluationBar";
import { EvaluationChart } from "./EvaluationChart";
import { GameReviewSummary } from "./GameReviewSummary";

interface ReviewScreenProps {
  game: StoredGame;
  repository: GameRepository;
  language: Language;
  onBack: () => void;
  t: (key: TranslationKey, variables?: Record<string, string | number>) => string;
}

export function ReviewScreen({ game, repository, language, onBack, t }: ReviewScreenProps) {
  const [positionIndex, setPositionIndex] = useState(0);
  const [orientation, setOrientation] = useState<"white" | "black">("white");
  const [analysisSnapshot, setAnalysisSnapshot] = useState<AnalysisSnapshot>({
    cacheKey: null,
    evaluations: [],
    loading: true,
    profile: "balanced",
  });
  const lastPositionIndex = game.positions.length - 1;
  const isCompletedGame = ["1-0", "0-1", "1/2-1/2"].includes(game.result);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "ArrowLeft") {
        event.preventDefault();
        setPositionIndex((current) => Math.max(0, current - 1));
      }
      if (event.key === "ArrowRight") {
        event.preventDefault();
        setPositionIndex((current) => Math.min(lastPositionIndex, current + 1));
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [lastPositionIndex]);

  const movePairs = useMemo(() => {
    const pairs: Array<{ number: number; white?: string; black?: string }> = [];
    for (let index = 0; index < game.moves.length; index += 2) {
      pairs.push({
        number: index / 2 + 1,
        white: game.moves[index],
        black: game.moves[index + 1],
      });
    }
    return pairs;
  }, [game.moves]);

  const activeEvaluations = useMemo(
    () => analysisSnapshot.loading ? [] : analysisSnapshot.evaluations,
    [analysisSnapshot.evaluations, analysisSnapshot.loading],
  );
  const moveRatings = useMemo(
    () => classifyGameMoves(game, activeEvaluations),
    [activeEvaluations, game],
  );
  const accuracy = useMemo(() => calculateGameAccuracy(moveRatings), [moveRatings]);
  const selectedRating = positionIndex > 0 ? moveRatings[positionIndex - 1] ?? null : null;
  const coachInsight = useMemo(
    () => isCompletedGame && selectedRating
      ? buildCoachInsight(game, selectedRating, activeEvaluations)
      : null,
    [activeEvaluations, game, isCompletedGame, selectedRating],
  );
  const codexRequest = useMemo(
    () => buildCodexAdviceRequest(game, coachInsight, language),
    [coachInsight, game, language],
  );
  const selectedEvaluation = activeEvaluations.find(
    (evaluation) => evaluation.positionIndex === positionIndex,
  ) ?? null;

  const goTo = (next: number) =>
    setPositionIndex(Math.min(lastPositionIndex, Math.max(0, next)));

  return (
    <main className="review-page">
      <header className="review-header">
        <button className="text-button" onClick={onBack}>← {t("backToLibrary")}</button>
        <div className="review-title">
          <span>{t("review")}</span>
          <strong>{game.white} <em>{game.result}</em> {game.black}</strong>
        </div>
        <button
          className="secondary-button"
          onClick={() => setOrientation((current) => current === "white" ? "black" : "white")}
        >
          <span aria-hidden="true">↻</span> {t("flipBoard")}
        </button>
      </header>

      <section className="review-workspace">
        <div className="board-column">
          <div className="board-stage">
            <EvaluationBar evaluation={selectedEvaluation} gameResult={game.result} t={t} />
            <div className="board-frame" data-testid="board-orientation" data-orientation={orientation}>
              <Chessboard
                options={{
                  id: `chessmate-${game.fingerprint}`,
                  position: game.positions[positionIndex],
                  boardOrientation: orientation,
                  allowDragging: false,
                  allowDrawingArrows: false,
                  showAnimations: true,
                  animationDurationInMs: 180,
                  darkSquareStyle: { backgroundColor: "#4f725f" },
                  lightSquareStyle: { backgroundColor: "#d8decf" },
                  boardStyle: { borderRadius: "8px", overflow: "hidden" },
                }}
              />
            </div>
          </div>
          <div className="position-controls" aria-label={t("review")}>
            <button onClick={() => goTo(0)} disabled={positionIndex === 0} aria-label={t("firstMove")}>|‹</button>
            <button onClick={() => goTo(positionIndex - 1)} disabled={positionIndex === 0} aria-label={t("previousMove")}>‹</button>
            <span aria-live="polite" data-testid="position-status">
              {positionIndex === 0 ? t("startingPosition") : `${t("move")} ${positionIndex} ${t("of")} ${game.moves.length}`}
            </span>
            <button onClick={() => goTo(positionIndex + 1)} disabled={positionIndex === lastPositionIndex} aria-label={t("nextMove")}>›</button>
            <button onClick={() => goTo(lastPositionIndex)} disabled={positionIndex === lastPositionIndex} aria-label={t("lastMove")}>›|</button>
          </div>
          <EvaluationChart
            evaluations={activeEvaluations}
            ratings={moveRatings}
            moves={game.moves}
            gameResult={game.result}
            selectedPositionIndex={positionIndex}
            onSelectPosition={goTo}
            t={t}
          />
          <CoachPanel
            insight={coachInsight}
            unavailable={!isCompletedGame}
            t={t}
          />
          <CodexAdvisorPanel
            key={`${analysisSnapshot.cacheKey ?? "no-cache"}:${codexRequest ? JSON.stringify(codexRequest) : "unavailable"}`}
            request={codexRequest}
            repository={repository}
            t={t}
          />
          <GameReviewSummary
            ratings={moveRatings}
            accuracy={accuracy}
            onSelectPosition={goTo}
            t={t}
          />
        </div>

        <aside className="moves-panel">
          <div className="game-meta">
            <div><span>{t("date")}</span><strong>{game.displayDate ?? t("unknown")}</strong></div>
            <div><span>{t("timeControl")}</span><strong>{game.timeControl ?? "—"}</strong></div>
            <div><span>{t("source")}</span><strong>{game.source ?? "—"}</strong></div>
          </div>
          <section className="move-ratings selected-move-summary" aria-label={t("selectedMoveRating")}>
            <MoveRatingDetail selected={selectedRating} t={t} />
          </section>
          <div className="move-list">
            {movePairs.map((pair) => {
              const whiteIndex = (pair.number - 1) * 2 + 1;
              const blackIndex = whiteIndex + 1;
              return (
                <div className="move-row" key={pair.number}>
                  <span className="move-number">{pair.number}.</span>
                  <button className={positionIndex === whiteIndex ? "selected-move" : ""} onClick={() => goTo(whiteIndex)}>
                    <span>{pair.white}</span>
                    <MoveRatingBadge rating={moveRatings[whiteIndex - 1]} t={t} />
                  </button>
                  {pair.black ? (
                    <button className={positionIndex === blackIndex ? "selected-move" : ""} onClick={() => goTo(blackIndex)}>
                      <span>{pair.black}</span>
                      <MoveRatingBadge rating={moveRatings[blackIndex - 1]} t={t} />
                    </button>
                  ) : <span />}
                </div>
              );
            })}
          </div>
          {isCompletedGame ? (
            <EnginePanel
              game={game}
              positionIndex={positionIndex}
              repository={repository}
              t={t}
              onAnalysisStateChange={setAnalysisSnapshot}
            />
          ) : (
            <section className="analysis-unavailable" aria-label={t("localAnalysis")}>
              <span className="eyebrow">{t("localAnalysis")}</span>
              <strong>{t("analysisFinishedGamesOnly")}</strong>
            </section>
          )}
        </aside>
      </section>
    </main>
  );
}
