import { useId } from "react";
import type { TranslationKey } from "../../i18n/translations";
import type { CodexAdviceIdentity, GameRepository } from "../../lib/db/gameRepository";
import { CodexAdvisorPanel } from "../adviser/CodexAdvisorPanel";
import type { CodexAdviceRequest, CodexAdviceResponse } from "../adviser/codexClient";
import { RatingIcon } from "../classification/RatingIcon";
import { ratingLabel } from "../classification/ratingPresentation";
import type { CoachInsight, CoachLineStatus } from "./coachInsight";

type Translate = (key: TranslationKey, variables?: Record<string, string | number>) => string;
export type CoachEmptyState =
  | "selectMove"
  | "startingPosition"
  | "engineLoading"
  | "stockfishUnavailable"
  | "analysisLoading"
  | "unfinishedGame";

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
  codexIdentity = null,
  emptyState = "selectMove",
  codexAvailable,
  requestAdvice,
  t,
}: {
  insight: CoachInsight | null;
  repository: GameRepository;
  codexRequest?: CodexAdviceRequest | null;
  codexIdentity?: CodexAdviceIdentity | null;
  emptyState?: CoachEmptyState;
  codexAvailable?: boolean;
  requestAdvice?: (input: CodexAdviceRequest) => Promise<CodexAdviceResponse>;
  t: Translate;
}) {
  const planHeadingId = useId();

  return (
    <section className="coach-panel unified-coach" aria-label={t("coachPanel")}>
      <div className="coach-heading">
        <span className="eyebrow">{t("coachPanel")}</span>
        {insight ? (
          <div className="coach-move-summary" data-testid="coach-rating-headline">
            <span
              className={`coach-rating-icon rating-${insight.rating.classification}`}
              aria-hidden="true"
            >
              <RatingIcon classification={insight.rating.classification} decorative />
            </span>
            <div className="coach-rating-copy">
              <strong>{ratingLabel(insight.rating.classification, t)}</strong>
              <small>{t("coachPlayedMove", { move: insight.rating.san })}</small>
            </div>
            <div className="coach-white-evaluation">
              <span>{t("coachWhiteEvaluation")}</span>
              <strong>{insight.whiteAfter ?? "—"}</strong>
            </div>
          </div>
        ) : (
          <strong>{t("codexPlan")}</strong>
        )}
      </div>

      {!insight ? (
        <p className="coach-empty">{t(EMPTY_STATE_KEYS[emptyState])}</p>
      ) : (
        <section
          className="coach-plan-region"
          role="region"
          aria-labelledby={planHeadingId}
          tabIndex={0}
        >
          <h2 id={planHeadingId}>{t("codexPlan")}</h2>
          <div className="coach-stockfish-line">
            <div>
              <span>{t("coachBetterLine")}</span>
              <strong>{insight.bestMoveSan ?? "—"}</strong>
            </div>
            {insight.lineStatus === "available" ? (
              <code aria-label={t("coachPrincipalVariation")}>
                {insight.principalVariationSan.join(" ")}
              </code>
            ) : (
              <p>{t(LINE_STATUS_KEYS[insight.lineStatus])}</p>
            )}
          </div>
          <CodexAdvisorPanel
            request={codexRequest}
            identity={codexIdentity}
            repository={repository}
            t={t}
            {...(codexAvailable === undefined ? {} : { available: codexAvailable })}
            {...(requestAdvice === undefined ? {} : { requestAdvice })}
          />
        </section>
      )}
    </section>
  );
}
