import { useEffect, useMemo, useState } from "react";
import { Chessboard } from "react-chessboard";
import type { TranslationKey } from "../../i18n/translations";
import type { GameRepository } from "../../lib/db/gameRepository";
import type { AnalysisSnapshot, StoredGame } from "../../types";
import { calculateGameAccuracy, classifyGameMoves } from "../classification/classifyMoves";
import { MoveRatingBadge, MoveRatingsSummary } from "../classification/MoveRatings";
import { EnginePanel } from "../engine/EnginePanel";

interface ReviewScreenProps {
  game: StoredGame;
  repository: GameRepository;
  onBack: () => void;
  t: (key: TranslationKey, variables?: Record<string, string | number>) => string;
}

export function ReviewScreen({ game, repository, onBack, t }: ReviewScreenProps) {
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

  const moveRatings = useMemo(
    () => classifyGameMoves(game, analysisSnapshot.loading ? [] : analysisSnapshot.evaluations),
    [analysisSnapshot.evaluations, analysisSnapshot.loading, game],
  );
  const accuracy = useMemo(() => calculateGameAccuracy(moveRatings), [moveRatings]);
  const selectedRating = positionIndex > 0 ? moveRatings[positionIndex - 1] ?? null : null;

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
          <div className="position-controls" aria-label={t("review")}>
            <button onClick={() => goTo(0)} disabled={positionIndex === 0} aria-label={t("firstMove")}>|‹</button>
            <button onClick={() => goTo(positionIndex - 1)} disabled={positionIndex === 0} aria-label={t("previousMove")}>‹</button>
            <span aria-live="polite" data-testid="position-status">
              {positionIndex === 0 ? t("startingPosition") : `${t("move")} ${positionIndex} ${t("of")} ${game.moves.length}`}
            </span>
            <button onClick={() => goTo(positionIndex + 1)} disabled={positionIndex === lastPositionIndex} aria-label={t("nextMove")}>›</button>
            <button onClick={() => goTo(lastPositionIndex)} disabled={positionIndex === lastPositionIndex} aria-label={t("lastMove")}>›|</button>
          </div>
        </div>

        <aside className="moves-panel">
          <div className="game-meta">
            <div><span>{t("date")}</span><strong>{game.displayDate ?? t("unknown")}</strong></div>
            <div><span>{t("timeControl")}</span><strong>{game.timeControl ?? "—"}</strong></div>
            <div><span>{t("source")}</span><strong>{game.source ?? "—"}</strong></div>
          </div>
          <MoveRatingsSummary accuracy={accuracy} selected={selectedRating} t={t} />
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
