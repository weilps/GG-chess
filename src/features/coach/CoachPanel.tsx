import { useId, useRef, useState } from "react";
import type { TranslationKey } from "../../i18n/translations";
import type { GameRepository } from "../../lib/db/gameRepository";
import { CodexAdvisorPanel } from "../adviser/CodexAdvisorPanel";
import type {
  CodexAdviceRequest,
  CodexAdviceResponse,
} from "../adviser/codexClient";
import { formatCentipawnLoss } from "../classification/classifyMoves";
import {
  RATING_REASON_KEYS,
  RATING_SYMBOLS,
  ratingLabel,
} from "../classification/ratingPresentation";
import type { CoachInsight, CoachLineStatus, CoachTipId } from "./coachInsight";

type Translate = (key: TranslationKey, variables?: Record<string, string | number>) => string;
type CoachTab = "explanation" | "planPractice";
export type CoachEmptyState =
  | "selectMove"
  | "startingPosition"
  | "engineLoading"
  | "stockfishUnavailable"
  | "analysisLoading"
  | "unfinishedGame";

const TIP_KEYS: Record<CoachTipId, TranslationKey> = {
  scanAllChecks: "coachTipScanAllChecks",
  calculateChecks: "coachTipCalculateChecks",
  compareCaptures: "coachTipCompareCaptures",
  forcingSafety: "coachTipForcingSafety",
  compareCandidates: "coachTipCompareCandidates",
  repeatProcess: "coachTipRepeatProcess",
  analyzeAdjacent: "coachTipAnalyzeAdjacent",
};

const LINE_STATUS_KEYS: Record<Exclude<CoachLineStatus, "available">, TranslationKey> = {
  missing: "coachLineMissing",
  invalid: "coachLineInvalid",
};

const EMPTY_STATE_KEYS: Record<CoachEmptyState, TranslationKey> = {
  selectMove: "coachSelectMove",
  startingPosition: "coachStartingPosition",
  engineLoading: "coachEngineLoading",
  stockfishUnavailable: "coachStockfishUnavailable",
  analysisLoading: "coachAnalysisLoading",
  unfinishedGame: "coachCompletedOnly",
};

export function CoachPanel({
  insight,
  repository,
  codexRequest = null,
  codexContextKey,
  emptyState = "selectMove",
  codexAvailable,
  requestAdvice,
  t,
}: {
  insight: CoachInsight | null;
  repository: GameRepository;
  codexRequest?: CodexAdviceRequest | null;
  codexContextKey?: string;
  emptyState?: CoachEmptyState;
  codexAvailable?: boolean;
  requestAdvice?: (input: CodexAdviceRequest) => Promise<CodexAdviceResponse>;
  t: Translate;
}) {
  const [activeTab, setActiveTab] = useState<CoachTab>("explanation");
  const tabId = useId();
  const explanationTabRef = useRef<HTMLButtonElement | null>(null);
  const planTabRef = useRef<HTMLButtonElement | null>(null);
  const explanationSelected = activeTab === "explanation";

  const selectTab = (tab: CoachTab, restoreFocus = false) => {
    setActiveTab(tab);
    if (restoreFocus) {
      window.requestAnimationFrame(() => {
        (tab === "explanation" ? explanationTabRef : planTabRef).current?.focus();
      });
    }
  };

  const handleTabKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>) => {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    event.stopPropagation();
    const nextTab = event.key === "Home"
      ? "explanation"
      : event.key === "End"
        ? "planPractice"
        : explanationSelected
          ? "planPractice"
          : "explanation";
    selectTab(nextTab, true);
  };

  // Remount only the adviser state when its move context changes; the selected Coach tab survives.
  const adviserKey = codexContextKey
    ?? (codexRequest ? JSON.stringify(codexRequest) : "codex-unavailable");

  return (
    <section className="coach-panel unified-coach" aria-label={t("coachPanel")}>
      <div className="coach-heading">
        <div>
          <span className="eyebrow">{t("coachPanel")}</span>
          {insight ? (
            <strong className="coach-rating-headline" data-testid="coach-rating-headline">
              <span
                className={`move-rating-badge rating-${insight.rating.classification}`}
                aria-hidden="true"
              >
                {RATING_SYMBOLS[insight.rating.classification]}
              </span>
              <span>{ratingLabel(insight.rating.classification, t)}</span>
              <span aria-hidden="true">·</span>
              <span>{insight.after ?? "—"}</span>
            </strong>
          ) : (
            <strong>{t("coachDeterministic")}</strong>
          )}
          {insight && <small>{t("coachPlayedMove", { move: insight.rating.san })}</small>}
        </div>
        <span aria-hidden="true">♞</span>
      </div>

      <div className="coach-tabs" role="tablist" aria-label={t("coachSections")}>
        <button
          ref={explanationTabRef}
          id={`${tabId}-explanation-tab`}
          role="tab"
          aria-selected={explanationSelected}
          aria-controls={`${tabId}-explanation-panel`}
          tabIndex={explanationSelected ? 0 : -1}
          onClick={() => selectTab("explanation")}
          onKeyDown={handleTabKeyDown}
        >
          {t("codexExplanation")}
        </button>
        <button
          ref={planTabRef}
          id={`${tabId}-plan-tab`}
          role="tab"
          aria-selected={!explanationSelected}
          aria-controls={`${tabId}-plan-panel`}
          tabIndex={explanationSelected ? -1 : 0}
          onClick={() => selectTab("planPractice")}
          onKeyDown={handleTabKeyDown}
        >
          {t("coachPlanPractice")}
        </button>
      </div>

      <div
        id={`${tabId}-${explanationSelected ? "explanation" : "plan"}-panel`}
        className="coach-tab-panel"
        role="tabpanel"
        aria-labelledby={`${tabId}-${explanationSelected ? "explanation" : "plan"}-tab`}
      >
        <div className="coach-local-content">
          {!insight ? (
            <p className="coach-empty">{t(EMPTY_STATE_KEYS[emptyState])}</p>
          ) : explanationSelected ? (
            insight.rating.classification === "notRated" ? (
              <div className="coach-section">
                <h3>{t("coachWhatHappened")}</h3>
                <p>{t(RATING_REASON_KEYS[insight.rating.reason])}</p>
              </div>
            ) : (
              <>
                <div className="coach-section">
                  <h3>{t("coachWhatHappened")}</h3>
                  <p>{t(RATING_REASON_KEYS[insight.rating.reason])}</p>
                  <div className="coach-metrics">
                    <span>{t("coachBefore")}<strong>{insight.before}</strong></span>
                    <span>{t("coachAfter")}<strong>{insight.after}</strong></span>
                    <span>{t("coachLoss")}<strong>{formatCentipawnLoss(insight.rating.centipawnLoss)}</strong></span>
                  </div>
                </div>
                <div className="coach-section">
                  <h3>{t("coachBetterLine")}</h3>
                  <div className="coach-best-move">
                    <span>{t("coachEngineMove")}</span>
                    <strong>{insight.bestMoveSan ?? "—"}</strong>
                  </div>
                  {insight.lineStatus === "available" ? (
                    <code aria-label={t("coachPrincipalVariation")}>
                      {insight.principalVariationSan.join(" ")}
                    </code>
                  ) : (
                    <p className="coach-line-empty">{t(LINE_STATUS_KEYS[insight.lineStatus])}</p>
                  )}
                </div>
              </>
            )
          ) : (
            <div className="coach-section coach-tip">
              <h3>{t("coachTryThis")}</h3>
              <p>{t(TIP_KEYS[insight.tip])}</p>
            </div>
          )}
        </div>

        <CodexAdvisorPanel
          key={adviserKey}
          request={codexRequest}
          repository={repository}
          t={t}
          embedded
          activeSection={activeTab}
          {...(codexAvailable === undefined ? {} : { available: codexAvailable })}
          {...(requestAdvice === undefined ? {} : { requestAdvice })}
        />
      </div>

      <small className="coach-disclaimer">{t("coachDisclaimer")}</small>
    </section>
  );
}
