import type { TranslationKey } from "../../i18n/translations";
import { formatCentipawnLoss } from "../classification/classifyMoves";
import { MoveRatingBadge } from "../classification/MoveRatings";
import {
  RATING_REASON_KEYS,
  ratingLabel,
} from "../classification/ratingPresentation";
import type { CoachInsight, CoachLineStatus, CoachTipId } from "./coachInsight";

type Translate = (key: TranslationKey, variables?: Record<string, string | number>) => string;

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

export function CoachPanel({
  insight,
  unavailable = false,
  t,
}: {
  insight: CoachInsight | null;
  unavailable?: boolean;
  t: Translate;
}) {
  return (
    <section className="coach-panel" aria-label={t("localCoach")}>
      <div className="coach-heading">
        <div>
          <span className="eyebrow">{t("localCoach")}</span>
          <strong>{t("coachDeterministic")}</strong>
        </div>
        <span aria-hidden="true">♞</span>
      </div>
      {unavailable ? (
        <p className="coach-empty">{t("coachCompletedOnly")}</p>
      ) : !insight ? (
        <p className="coach-empty">{t("coachSelectMove")}</p>
      ) : (
        <div className="coach-content">
          <div className="coach-verdict">
            <MoveRatingBadge rating={insight.rating} t={t} />
            <div>
              <strong>{ratingLabel(insight.rating.classification, t)}</strong>
              <span>{t("coachPlayedMove", { move: insight.rating.san })}</span>
            </div>
          </div>
          {insight.rating.classification === "notRated" ? (
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
          )}
          <div className="coach-section coach-tip">
            <h3>{t("coachTryThis")}</h3>
            <p>{t(TIP_KEYS[insight.tip])}</p>
          </div>
        </div>
      )}
      <small className="coach-disclaimer">{t("coachDisclaimer")}</small>
    </section>
  );
}
