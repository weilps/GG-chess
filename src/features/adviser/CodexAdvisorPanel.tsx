import { useCallback, useEffect, useRef, useState } from "react";
import type { TranslationKey } from "../../i18n/translations";
import type { GameRepository } from "../../lib/db/gameRepository";
import {
  codexAdviserAvailable,
  codexErrorCode,
  requestCodexAdvice,
  type CodexAdviceRequest,
  type CodexAdviceResponse,
} from "./codexClient";

const CONSENT_SETTING = "codexAdvisorEnabled";

type Translate = (key: TranslationKey, variables?: Record<string, string | number>) => string;
type ConsentState = "loading" | "enabled" | "disabled";

function errorTranslation(code: string): TranslationKey {
  if (code.includes("cli_missing")) return "codexErrorMissing";
  if (code.includes("not_logged_in")) return "codexErrorLogin";
  if (code.includes("busy")) return "codexErrorBusy";
  if (code.includes("timeout")) return "codexErrorTimeout";
  if (code.includes("malformed")) return "codexErrorMalformed";
  return "codexErrorExecution";
}

export function CodexAdvisorPanel({
  request,
  repository,
  t,
  available = codexAdviserAvailable(),
  requestAdvice = requestCodexAdvice,
}: {
  request: CodexAdviceRequest | null;
  repository: GameRepository;
  t: Translate;
  available?: boolean;
  requestAdvice?: (input: CodexAdviceRequest) => Promise<CodexAdviceResponse>;
}) {
  const [consent, setConsent] = useState<ConsentState>("loading");
  const [showConsent, setShowConsent] = useState(false);
  const [loading, setLoading] = useState(false);
  const [response, setResponse] = useState<CodexAdviceResponse | null>(null);
  const [errorKey, setErrorKey] = useState<TranslationKey | null>(null);
  const requestSequence = useRef(0);

  useEffect(() => {
    let active = true;
    repository.getSetting(CONSENT_SETTING)
      .then((saved) => {
        if (active) setConsent(saved === "true" ? "enabled" : "disabled");
      })
      .catch(() => {
        if (active) setConsent("disabled");
      });
    return () => { active = false; };
  }, [repository]);

  useEffect(() => () => {
    requestSequence.current += 1;
  }, []);

  const enable = useCallback(async () => {
    await repository.setSetting(CONSENT_SETTING, "true");
    setConsent("enabled");
    setShowConsent(false);
  }, [repository]);

  const disable = useCallback(async () => {
    requestSequence.current += 1;
    await repository.setSetting(CONSENT_SETTING, "false");
    setConsent("disabled");
    setShowConsent(false);
    setLoading(false);
    setResponse(null);
    setErrorKey(null);
  }, [repository]);

  const ask = useCallback(async () => {
    if (!request || !available) return;
    if (consent !== "enabled") {
      setShowConsent(true);
      return;
    }
    const sequence = ++requestSequence.current;
    setLoading(true);
    setResponse(null);
    setErrorKey(null);
    try {
      const answer = await requestAdvice(request);
      if (requestSequence.current === sequence) setResponse(answer);
    } catch (error) {
      if (requestSequence.current === sequence) {
        setErrorKey(errorTranslation(codexErrorCode(error)));
      }
    } finally {
      if (requestSequence.current === sequence) setLoading(false);
    }
  }, [available, consent, request, requestAdvice]);

  return (
    <section className="codex-adviser" aria-label={t("codexAdviser")}>
      <div className="codex-adviser-heading">
        <div>
          <span className="eyebrow">{t("codexAdviser")}</span>
          <strong>{t("codexAdviserOptional")}</strong>
        </div>
        {consent === "enabled" && (
          <button className="text-button" onClick={() => void disable()}>{t("codexDisable")}</button>
        )}
      </div>

      {!available ? (
        <p className="codex-adviser-empty">{t("codexWindowsOnly")}</p>
      ) : !request ? (
        <p className="codex-adviser-empty">{t("codexSelectRatedMove")}</p>
      ) : showConsent ? (
        <div className="codex-consent">
          <strong>{t("codexConsentTitle")}</strong>
          <p>{t("codexConsentBody")}</p>
          <small>{t("codexConsentData")}</small>
          <div>
            <button className="primary-button" onClick={() => void enable()}>{t("codexEnable")}</button>
            <button className="secondary-button" onClick={() => void disable()}>{t("codexCancel")}</button>
          </div>
        </div>
      ) : response ? (
        <div className="codex-answer" aria-live="polite">
          <section><h3>{t("codexSummary")}</h3><p>{response.advice.summary}</p></section>
          <section><h3>{t("codexExplanation")}</h3><p>{response.advice.explanation}</p></section>
          <section><h3>{t("codexPlan")}</h3><p>{response.advice.plan}</p></section>
          <section><h3>{t("codexPractice")}</h3><p>{response.advice.practice}</p></section>
          <div className="codex-answer-meta">
            <span>{response.model}</span>
            <span>{response.reasoning}</span>
            <span>{t("codexDuration", { seconds: (response.durationMs / 1_000).toFixed(1) })}</span>
          </div>
          <button className="secondary-button" onClick={() => void ask()}>{t("codexRegenerate")}</button>
        </div>
      ) : (
        <div className="codex-ready">
          <p>{t("codexReadyBody")}</p>
          {errorKey && <p className="codex-error" role="alert">{t(errorKey)}</p>}
          <button className="primary-button" disabled={loading || consent === "loading"} onClick={() => void ask()}>
            {loading ? t("codexThinking") : t("codexAsk")}
          </button>
        </div>
      )}

      <small className="codex-bridge-note">{t("codexBridgeNote")}</small>
    </section>
  );
}
