import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Chessboard } from "react-chessboard";
import type { TranslationKey } from "../../i18n/translations";
import type { GameRepository } from "../../lib/db/gameRepository";
import type { AnalysisSnapshot, Language, StoredGame } from "../../types";
import { buildCodexAdviceIdentity, buildCodexAdviceRequest } from "../adviser/codexClient";
import { calculateGameAccuracy, classifyGameMoves } from "../classification/classifyMoves";
import { MoveRatingBadge } from "../classification/MoveRatings";
import { CoachPanel, type CoachEmptyState } from "../coach/CoachPanel";
import { buildCoachInsight } from "../coach/coachInsight";
import { EnginePanel } from "../engine/EnginePanel";
import { BoardGuidanceOverlay } from "./BoardGuidanceOverlay";
import { buildBoardGuidance } from "./boardGuidance";
import { EvaluationBar } from "./EvaluationBar";
import { EvaluationChart } from "./EvaluationChart";
import { GameReviewSummary } from "./GameReviewSummary";
import { shouldPreserveReviewArrowKey } from "./reviewKeyboard";

interface ReviewScreenProps {
  game: StoredGame;
  repository: GameRepository;
  language: Language;
  onLanguageChange?: (language: Language) => void;
  onBack: () => void;
  onOpenTraining?: () => void;
  onOpenAbout?: () => void;
  t: (key: TranslationKey, variables?: Record<string, string | number>) => string;
}

function MoreIcon() {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
      <circle cx="5" cy="12" r="1.8" fill="currentColor" />
      <circle cx="12" cy="12" r="1.8" fill="currentColor" />
      <circle cx="19" cy="12" r="1.8" fill="currentColor" />
    </svg>
  );
}

function KnightMarkIcon() {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
      <path
        d="M8.5 19h9M9.5 16.5h7.2l-.8-3.2c-.4-1.6-1.4-2.8-2.8-3.7l-1.8-1.1.8-2.8-3.8 1.6L6.5 11l3.3.3-1.7 2.1 1.4 3.1Z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="10.2" cy="8.1" r=".8" fill="currentColor" />
    </svg>
  );
}

function FlipIcon() {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
      <path d="M18.5 8.5V4l-1.8 1.8A7.5 7.5 0 0 0 5 9" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M5.5 15.5V20l1.8-1.8A7.5 7.5 0 0 0 19 15" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function ReviewScreen({
  game,
  repository,
  language,
  onLanguageChange = () => undefined,
  onBack,
  onOpenTraining = () => undefined,
  onOpenAbout = () => undefined,
  t,
}: ReviewScreenProps) {
  const [positionIndex, setPositionIndex] = useState(0);
  const [orientation, setOrientation] = useState<"white" | "black">("white");
  const [reviewTab, setReviewTab] = useState<"moves" | "summary">("moves");
  const [moreMenuOpen, setMoreMenuOpen] = useState(false);
  const moreButtonRef = useRef<HTMLButtonElement | null>(null);
  const moreMenuRef = useRef<HTMLDivElement | null>(null);
  const [analysisSnapshot, setAnalysisSnapshot] = useState<AnalysisSnapshot>({
    cacheKey: null,
    evaluations: [],
    engineStatus: "loading",
    loading: true,
    profile: "balanced",
    multiPv: 1,
    guidanceEnabled: true,
    guidanceMode: "next",
  });
  const lastPositionIndex = game.positions.length - 1;
  const isCompletedGame = ["1-0", "0-1", "1/2-1/2"].includes(game.result);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || shouldPreserveReviewArrowKey(event.target)) return;
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

  const closeMoreMenu = useCallback((restoreFocus = true) => {
    setMoreMenuOpen(false);
    if (restoreFocus) moreButtonRef.current?.focus();
  }, []);

  useEffect(() => {
    if (!moreMenuOpen) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        closeMoreMenu();
      }
    };
    const handlePointerDown = (event: PointerEvent) => {
      if (!moreMenuRef.current?.contains(event.target as Node)) closeMoreMenu();
    };
    window.addEventListener("keydown", handleKeyDown);
    document.addEventListener("pointerdown", handlePointerDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      document.removeEventListener("pointerdown", handlePointerDown);
    };
  }, [closeMoreMenu, moreMenuOpen]);

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
  const guidancePlan = useMemo(() => buildBoardGuidance({
    enabled: analysisSnapshot.guidanceEnabled,
    engineStatus: analysisSnapshot.engineStatus,
    evaluations: activeEvaluations,
    game,
    loading: analysisSnapshot.loading,
    mode: analysisSnapshot.guidanceMode,
    multiPv: analysisSnapshot.multiPv,
    positionIndex,
    selectedRating,
  }), [activeEvaluations, analysisSnapshot.engineStatus, analysisSnapshot.guidanceEnabled, analysisSnapshot.guidanceMode, analysisSnapshot.loading, analysisSnapshot.multiPv, game, positionIndex, selectedRating]);
  const coachInsight = useMemo(
    () => isCompletedGame
      && selectedRating
      && analysisSnapshot.engineStatus === "ready"
      && !analysisSnapshot.loading
      ? buildCoachInsight(game, selectedRating, activeEvaluations)
      : null,
    [activeEvaluations, analysisSnapshot.engineStatus, analysisSnapshot.loading, game, isCompletedGame, selectedRating],
  );
  const codexRequest = useMemo(
    () => buildCodexAdviceRequest(game, coachInsight, language),
    [coachInsight, game, language],
  );
  const codexIdentity = useMemo(
    () => buildCodexAdviceIdentity(
      game.fingerprint,
      positionIndex,
      analysisSnapshot.cacheKey,
      codexRequest,
    ),
    [analysisSnapshot.cacheKey, codexRequest, game.fingerprint, positionIndex],
  );
  const selectedEvaluation = activeEvaluations.find(
    (evaluation) => evaluation.positionIndex === guidancePlan.boardPositionIndex,
  ) ?? null;
  const coachEmptyState: CoachEmptyState = !isCompletedGame
    ? "unfinishedGame"
    : positionIndex === 0
      ? "startingPosition"
      : analysisSnapshot.engineStatus === "loading"
        ? "engineLoading"
        : analysisSnapshot.engineStatus === "missing" || analysisSnapshot.engineStatus === "error"
          ? "stockfishUnavailable"
          : analysisSnapshot.loading
            ? "analysisLoading"
            : "selectMove";

  const goTo = (next: number) =>
    setPositionIndex(Math.min(lastPositionIndex, Math.max(0, next)));

  const selectReviewTab = (tab: "moves" | "summary") => {
    setReviewTab(tab);
    window.requestAnimationFrame(() => document.getElementById(`review-${tab}-tab`)?.focus());
  };

  const handleTabKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>) => {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    event.stopPropagation();
    selectReviewTab(event.key === "ArrowLeft" || event.key === "Home" ? "moves" : "summary");
  };

  return (
    <main className="review-page">
      <header className="review-header">
        <button className="review-brand" onClick={onBack} aria-label={t("backToLibrary")} title={t("backToLibrary")}>
          <span className="brand-mark review-brand-mark" aria-hidden="true"><KnightMarkIcon /></span>
          <span><strong>{t("appName")}</strong><small>{t("backToLibrary")}</small></span>
        </button>
        <div className="review-title">
          <strong>{game.white} <em>{game.result}</em> {game.black}</strong>
          <span>{t("review")}</span>
        </div>
        <div className="review-header-actions">
          {isCompletedGame ? (
            <EnginePanel
              compact
              game={game}
              positionIndex={positionIndex}
              repository={repository}
              t={t}
              onAnalysisStateChange={setAnalysisSnapshot}
            />
          ) : (
            <span className="analysis-header-unavailable" title={t("analysisFinishedGamesOnly")}>
              {t("analyze")}
              <span className="sr-only">{t("analysisFinishedGamesOnly")}</span>
            </span>
          )}
          <button
            className="review-icon-button"
            onClick={() => setOrientation((current) => current === "white" ? "black" : "white")}
            aria-label={t("flipBoard")}
            title={t("flipBoard")}
          >
            <FlipIcon />
          </button>
          <div className="language-switcher review-language-switcher" aria-label={t("language")}>
            <button className={language === "en" ? "active" : ""} onClick={() => onLanguageChange("en")}>EN</button>
            <button className={language === "fr" ? "active" : ""} onClick={() => onLanguageChange("fr")}>FR</button>
          </div>
          <div className="review-more-menu" ref={moreMenuRef} data-open={moreMenuOpen}>
            <button
              ref={moreButtonRef}
              className="review-icon-button"
              aria-expanded={moreMenuOpen}
              aria-haspopup="menu"
              aria-label={t("more")}
              title={t("more")}
              onClick={() => setMoreMenuOpen((open) => !open)}
            >
              <MoreIcon />
            </button>
            {moreMenuOpen ? (
              <div role="menu">
                <button role="menuitem" onClick={() => { closeMoreMenu(false); onOpenTraining(); }}>{t("trainingLab")}</button>
                <button role="menuitem" onClick={() => { closeMoreMenu(false); onOpenAbout(); }}>{t("about")}</button>
              </div>
            ) : null}
          </div>
        </div>
      </header>

      <section className="review-workspace">
        <div className="board-column">
          <div className="board-stage">
            <EvaluationBar evaluation={selectedEvaluation} gameResult={game.result} t={t} />
            <div className="board-frame" data-testid="board-orientation" data-orientation={orientation}>
              <Chessboard
                options={{
                  id: `chessmate-${game.fingerprint}`,
                  position: game.positions[guidancePlan.boardPositionIndex],
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
              <BoardGuidanceOverlay arrows={guidancePlan.arrows} orientation={orientation} t={t} />
            </div>
          </div>
          <div className="position-controls" aria-label={t("review")}>
            <button onClick={() => goTo(0)} disabled={positionIndex === 0} aria-label={t("firstMove")}>|‹</button>
            <button onClick={() => goTo(positionIndex - 1)} disabled={positionIndex === 0} aria-label={t("previousMove")}>‹</button>
            <span aria-live="polite" data-testid="position-status">
              {positionIndex === 0
                ? t("startingPosition")
                : analysisSnapshot.guidanceMode === "compare"
                  ? t("guidanceComparePosition", { move: positionIndex, total: game.moves.length })
                  : `${t("move")} ${positionIndex} ${t("of")} ${game.moves.length}`}
            </span>
            <button onClick={() => goTo(positionIndex + 1)} disabled={positionIndex === lastPositionIndex} aria-label={t("nextMove")}>›</button>
            <button onClick={() => goTo(lastPositionIndex)} disabled={positionIndex === lastPositionIndex} aria-label={t("lastMove")}>›|</button>
          </div>
          <EvaluationChart
            compact
            evaluations={activeEvaluations}
            ratings={moveRatings}
            moves={game.moves}
            gameResult={game.result}
            selectedPositionIndex={positionIndex}
            onSelectPosition={goTo}
            t={t}
          />
        </div>

        <aside className="review-sidebar">
          <CoachPanel
            insight={coachInsight}
            emptyState={coachEmptyState}
            codexRequest={codexRequest}
            codexIdentity={codexIdentity}
            repository={repository}
            t={t}
          />
          <div className="review-lower-panel">
            <div className="review-tabs" role="tablist" aria-label={t("reviewPanels")}>
              <button
                id="review-moves-tab"
                role="tab"
                aria-selected={reviewTab === "moves"}
                aria-controls="review-moves-panel"
                tabIndex={reviewTab === "moves" ? 0 : -1}
                onClick={() => setReviewTab("moves")}
                onKeyDown={handleTabKeyDown}
              >
                {t("movesTab")}
              </button>
              <button
                id="review-summary-tab"
                role="tab"
                aria-selected={reviewTab === "summary"}
                aria-controls="review-summary-panel"
                tabIndex={reviewTab === "summary" ? 0 : -1}
                onClick={() => setReviewTab("summary")}
                onKeyDown={handleTabKeyDown}
              >
                {t("summaryTab")}
              </button>
            </div>
            {reviewTab === "moves" ? (
              <section
                id="review-moves-panel"
                className="moves-tab-content"
                role="tabpanel"
                aria-labelledby="review-moves-tab"
              >
                <div className="game-meta">
                  <div><span>{t("date")}</span><strong>{game.displayDate ?? t("unknown")}</strong></div>
                  <div><span>{t("timeControl")}</span><strong>{game.timeControl ?? "—"}</strong></div>
                  <div><span>{t("source")}</span><strong>{game.source ?? "—"}</strong></div>
                </div>
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
              </section>
            ) : (
              <section
                id="review-summary-panel"
                className="summary-tab-content"
                role="tabpanel"
                aria-labelledby="review-summary-tab"
              >
                <GameReviewSummary
                  ratings={moveRatings}
                  accuracy={accuracy}
                  onSelectPosition={goTo}
                  t={t}
                />
              </section>
            )}
          </div>
        </aside>
      </section>
    </main>
  );
}
