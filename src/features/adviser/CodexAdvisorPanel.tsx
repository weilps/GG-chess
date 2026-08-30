import { useCallback, useEffect, useRef, useState } from "react";
import type { TranslationKey } from "../../i18n/translations";
import type {
  CodexAdviceIdentity,
  GameRepository,
  StoredCodexAdvice,
} from "../../lib/db/gameRepository";
import {
  CODEX_SCHEMA_VERSION,
  codexAdviserAvailable,
  codexAdviceIdentityKey,
  codexErrorCode,
  requestCodexAdvice,
  type CodexAdviceRequest,
  type CodexAdviceResponse,
} from "./codexClient";

const CONSENT_SETTING = "codexAdvisorEnabled";
const adviceSaveQueues = new WeakMap<GameRepository, Map<string, Promise<void>>>();

type Translate = (key: TranslationKey, variables?: Record<string, string | number>) => string;
type ConsentState = "loading" | "enabled" | "disabled";

interface CodexAdvisorPanelProps {
  request: CodexAdviceRequest | null;
  identity: CodexAdviceIdentity | null;
  repository: GameRepository;
  t: Translate;
  available?: boolean;
  requestAdvice?: (input: CodexAdviceRequest) => Promise<CodexAdviceResponse>;
}

function errorTranslation(code: string): TranslationKey {
  if (code.includes("cli_missing")) return "codexErrorMissing";
  if (code.includes("not_logged_in")) return "codexErrorLogin";
  if (code.includes("busy")) return "codexErrorBusy";
  if (code.includes("timeout")) return "codexErrorTimeout";
  if (code.includes("malformed")) return "codexErrorMalformed";
  if (code.includes("storage")) return "codexErrorStorage";
  return "codexErrorExecution";
}

function saveAdviceInRequestOrder(
  repository: GameRepository,
  advice: StoredCodexAdvice,
): Promise<void> {
  let queues = adviceSaveQueues.get(repository);
  if (!queues) {
    queues = new Map<string, Promise<void>>();
    adviceSaveQueues.set(repository, queues);
  }

  const key = codexAdviceIdentityKey(advice);
  const previous = queues.get(key) ?? Promise.resolve();
  const current = previous
    .catch(() => undefined)
    .then(() => repository.saveCodexAdvice(advice));
  queues.set(key, current);
  const clear = () => {
    if (queues?.get(key) === current) queues.delete(key);
  };
  current.then(clear, clear);
  return current;
}

export function CodexAdvisorPanel(props: CodexAdvisorPanelProps) {
  return <CodexAdvisorContent key={codexAdviceIdentityKey(props.identity)} {...props} />;
}

function CodexAdvisorContent({
  request,
  identity,
  repository,
  t,
  available = codexAdviserAvailable(),
  requestAdvice = requestCodexAdvice,
}: CodexAdvisorPanelProps) {
  const [consent, setConsent] = useState<ConsentState>("loading");
  const [showConsent, setShowConsent] = useState(false);
  const [cacheLoading, setCacheLoading] = useState(Boolean(identity));
  const [loading, setLoading] = useState(false);
  const [advice, setAdvice] = useState<StoredCodexAdvice | null>(null);
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

  useEffect(() => {
    const sequence = ++requestSequence.current;
    let active = true;
    if (!identity) {
      return () => { active = false; };
    }
    repository.getCodexAdvice(identity)
      .then((saved) => {
        if (active && requestSequence.current === sequence) setAdvice(saved);
      })
      .catch(() => {
        if (active && requestSequence.current === sequence) setErrorKey("codexErrorStorage");
      })
      .finally(() => {
        if (active && requestSequence.current === sequence) setCacheLoading(false);
    });
    return () => { active = false; };
  }, [identity, repository]);

  useEffect(() => () => {
    requestSequence.current += 1;
  }, []);

  const enable = useCallback(async () => {
    try {
      await repository.setSetting(CONSENT_SETTING, "true");
      setConsent("enabled");
      setShowConsent(false);
    } catch {
      setShowConsent(false);
      setErrorKey("codexErrorStorage");
    }
  }, [repository]);

  const disable = useCallback(async () => {
    requestSequence.current += 1;
    setErrorKey(null);
    try {
      await repository.setSetting(CONSENT_SETTING, "false");
    } catch {
      setErrorKey("codexErrorStorage");
    }
    setConsent("disabled");
    setShowConsent(false);
    setLoading(false);
    setAdvice(null);
  }, [repository]);

  const ask = useCallback(async () => {
    if (!request || !identity || !available) return;
    if (consent !== "enabled") {
      setShowConsent(true);
      return;
    }
    const sequence = ++requestSequence.current;
    setLoading(true);
    setErrorKey(null);
    try {
      const answer = await requestAdvice(request);
      if (
        requestSequence.current !== sequence
        || answer.schemaVersion !== CODEX_SCHEMA_VERSION
        || answer.schemaVersion !== identity.schemaVersion
        || !answer.advice.plan.trim()
      ) {
        if (requestSequence.current === sequence) setErrorKey("codexErrorMalformed");
        return;
      }
      const saved: StoredCodexAdvice = {
        ...identity,
        plan: answer.advice.plan.trim(),
        model: answer.model,
        reasoning: answer.reasoning,
        durationMs: answer.durationMs,
        updatedAt: new Date().toISOString(),
      };
      try {
        await saveAdviceInRequestOrder(repository, saved);
      } catch {
        throw new Error("codex_storage_failed");
      }
      if (requestSequence.current === sequence) setAdvice(saved);
    } catch (error) {
      if (requestSequence.current === sequence) {
        setErrorKey(errorTranslation(codexErrorCode(error)));
      }
    } finally {
      if (requestSequence.current === sequence) setLoading(false);
    }
  }, [available, consent, identity, request, repository, requestAdvice]);

  if (!available) {
    return <p className="codex-plan-state">{t("codexWindowsOnly")}</p>;
  }
  if (!request || !identity) {
    return <p className="codex-plan-state">{t("codexSelectRatedMove")}</p>;
  }
  if (showConsent) {
    return (
      <div className="codex-consent">
        <strong>{t("codexConsentTitle")}</strong>
        <p>{t("codexConsentBody")}</p>
        <small>{t("codexConsentData")}</small>
        <div>
          <button className="primary-button" onClick={() => void enable()}>{t("codexEnable")}</button>
          <button className="secondary-button" onClick={() => setShowConsent(false)}>{t("codexCancel")}</button>
        </div>
      </div>
    );
  }
  if (cacheLoading) {
    return <p className="codex-plan-state" role="status">{t("codexLoadingSaved")}</p>;
  }

  return advice ? (
    <div className="codex-plan-answer" aria-live="polite" aria-busy={loading}>
      <p>{advice.plan}</p>
      {errorKey && <p className="codex-error" role="alert">{t(errorKey)}</p>}
      <div className="codex-plan-actions">
        <button className="secondary-button" disabled={loading} onClick={() => void ask()}>
          {loading ? t("codexThinking") : t("codexRegenerate")}
        </button>
        {consent === "enabled" && (
          <button className="text-button" disabled={loading} onClick={() => void disable()}>
            {t("codexDisable")}
          </button>
        )}
      </div>
    </div>
  ) : (
    <div className="codex-ready">
      <p>{t("codexReadyBody")}</p>
      {errorKey && <p className="codex-error" role="alert">{t(errorKey)}</p>}
      <div className="codex-plan-actions">
        <button className="primary-button" disabled={loading || consent === "loading"} onClick={() => void ask()}>
          {loading ? t("codexThinking") : t("codexAsk")}
        </button>
        {consent === "enabled" && (
          <button className="text-button" disabled={loading} onClick={() => void disable()}>
            {t("codexDisable")}
          </button>
        )}
      </div>
    </div>
  );
}
