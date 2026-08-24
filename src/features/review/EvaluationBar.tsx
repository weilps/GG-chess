import type { TranslationKey } from "../../i18n/translations";
import type { PositionEvaluation } from "../../types";
import { formatWhiteEvaluation, whiteEvaluationShare } from "./gameReview";

type Translate = (key: TranslationKey, variables?: Record<string, string | number>) => string;

export function EvaluationBar({
  evaluation,
  gameResult,
  t,
}: {
  evaluation: PositionEvaluation | null;
  gameResult: string;
  t: Translate;
}) {
  const share = whiteEvaluationShare(evaluation, gameResult);
  const whitePercent = share ?? 50;
  const formatted = evaluation ? formatWhiteEvaluation(evaluation, gameResult) : "—";
  const label = share === null
    ? t("evaluationBarUnavailable")
    : t("evaluationBarLabel", {
      evaluation: formatted,
      whitePercent: Math.round(whitePercent),
    });

  return (
    <div
      className={`evaluation-bar${share === null ? " evaluation-bar-unavailable" : ""}`}
      role="meter"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={share === null ? undefined : Math.round(whitePercent)}
    >
      <div className="evaluation-bar-track">
        <div className="evaluation-bar-white" style={{ height: `${whitePercent}%` }} />
        <strong>{formatted}</strong>
      </div>
    </div>
  );
}
