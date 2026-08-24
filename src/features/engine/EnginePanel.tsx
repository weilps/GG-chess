import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { TranslationKey } from "../../i18n/translations";
import type { GameRepository } from "../../lib/db/gameRepository";
import type {
  AnalysisProfileId,
  AnalysisSnapshot,
  EngineInfo,
  PositionEvaluation,
  StoredGame,
} from "../../types";
import {
  ANALYSIS_PROFILES,
  analyzePositions,
  cancelAnalysis,
  detectStockfish,
  engineAvailable,
  engineErrorCode,
  formatEvaluation,
  selectEnginePath,
  subscribeToAnalysisProgress,
  validateEngine,
} from "./engineClient";

interface EnginePanelProps {
  game: StoredGame;
  positionIndex: number;
  repository: GameRepository;
  t: (key: TranslationKey, variables?: Record<string, string | number>) => string;
  onAnalysisStateChange?: (snapshot: AnalysisSnapshot) => void;
}

type EngineStatus = "loading" | "ready" | "missing" | "error";

interface EvaluationCacheState {
  key: string | null;
  values: PositionEvaluation[];
  loading: boolean;
}

function upsertEvaluation(
  evaluations: PositionEvaluation[],
  evaluation: PositionEvaluation,
): PositionEvaluation[] {
  return [...evaluations.filter((item) => item.positionIndex !== evaluation.positionIndex), evaluation]
    .sort((left, right) => left.positionIndex - right.positionIndex);
}

function localizedEngineError(code: string): TranslationKey {
  if (code.includes("unfinished_game")) return "analysisFinishedGamesOnly";
  if (code.includes("not_found")) return "engineErrorMissing";
  if (code.includes("not_uci") || code.includes("not_executable")) return "engineErrorNotUci";
  if (code.includes("exited") || code.includes("start_failed")) return "engineErrorExited";
  if (code.includes("malformed")) return "engineErrorMalformed";
  if (code.includes("timeout")) return "engineErrorTimeout";
  return "engineErrorUnknown";
}

export function EnginePanel({
  game,
  positionIndex,
  repository,
  t,
  onAnalysisStateChange,
}: EnginePanelProps) {
  const [engine, setEngine] = useState<EngineInfo | null>(null);
  const [engineStatus, setEngineStatus] = useState<EngineStatus>("loading");
  const [profileId, setProfileId] = useState<AnalysisProfileId>("balanced");
  const [evaluationCache, setEvaluationCache] = useState<EvaluationCacheState>({
    key: null,
    values: [],
    loading: true,
  });
  const [progress, setProgress] = useState<{ current: number; total: number } | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [isCancelling, setIsCancelling] = useState(false);
  const [errorKey, setErrorKey] = useState<TranslationKey | null>(null);
  const analysisIdRef = useRef<string | null>(null);

  const profile = ANALYSIS_PROFILES.find((item) => item.id === profileId) ?? ANALYSIS_PROFILES[1];
  const activeCacheKey = engine
    ? [game.fingerprint, engine.name, engine.version, profileId].join("\u0000")
    : null;
  const evaluations = useMemo(
    () => evaluationCache.key === activeCacheKey ? evaluationCache.values : [],
    [activeCacheKey, evaluationCache],
  );
  const isCacheLoading = activeCacheKey !== null
    && (evaluationCache.key !== activeCacheKey || evaluationCache.loading);
  const currentEvaluation = evaluations.find((item) => item.positionIndex === positionIndex);
  const complete = evaluations.length === game.positions.length;

  useEffect(() => {
    onAnalysisStateChange?.({
      cacheKey: activeCacheKey,
      evaluations,
      loading: isCacheLoading,
      profile: profileId,
    });
  }, [activeCacheKey, evaluations, isCacheLoading, onAnalysisStateChange, profileId]);

  useEffect(() => {
    let active = true;
    repository.getSetting("analysisProfile")
      .then((saved) => {
        if (active && ANALYSIS_PROFILES.some((item) => item.id === saved)) {
          setProfileId(saved as AnalysisProfileId);
        }
      })
      .catch(() => undefined);
    return () => { active = false; };
  }, [repository]);

  useEffect(() => {
    let active = true;
    async function configureEngine() {
      if (!engineAvailable()) {
        if (active) setEngineStatus("missing");
        return;
      }
      try {
        const savedPath = await repository.getSetting("enginePath");
        let configured: EngineInfo | null = null;
        if (savedPath) {
          try {
            configured = await validateEngine(savedPath);
          } catch {
            configured = null;
          }
        }
        configured ??= await detectStockfish();
        if (!active) return;
        if (configured) {
          await repository.setSetting("enginePath", configured.path);
          setEngine(configured);
          setEngineStatus("ready");
        } else {
          setEngineStatus("missing");
        }
      } catch {
        if (active) setEngineStatus("error");
      }
    }
    void configureEngine();
    return () => { active = false; };
  }, [repository]);

  useEffect(() => {
    let active = true;
    if (!engine) {
      return () => { active = false; };
    }
    repository.getAnalysis(game.fingerprint, engine, profileId)
      .then((stored) => {
        if (active) {
          setEvaluationCache({ key: activeCacheKey, values: stored, loading: false });
        }
      })
      .catch(() => {
        if (active) {
          setEvaluationCache({ key: activeCacheKey, values: [], loading: false });
          setErrorKey("engineErrorCache");
        }
      });
    return () => { active = false; };
  }, [activeCacheKey, engine, game.fingerprint, profileId, repository]);

  const chooseEngine = useCallback(async () => {
    setErrorKey(null);
    try {
      const path = await selectEnginePath();
      if (!path) return;
      const selected = await validateEngine(path);
      await repository.setSetting("enginePath", selected.path);
      onAnalysisStateChange?.({
        cacheKey: null,
        evaluations: [],
        loading: true,
        profile: profileId,
      });
      setEngine(selected);
      setEngineStatus("ready");
    } catch (error) {
      setEngineStatus("error");
      setErrorKey(localizedEngineError(engineErrorCode(error)));
    }
  }, [onAnalysisStateChange, profileId, repository]);

  const changeProfile = useCallback(async (next: AnalysisProfileId) => {
    onAnalysisStateChange?.({
      cacheKey: null,
      evaluations: [],
      loading: true,
      profile: next,
    });
    setProfileId(next);
    await repository.setSetting("analysisProfile", next);
  }, [onAnalysisStateChange, repository]);

  const runAnalysis = useCallback(async (replace: boolean) => {
    if (!engine || !activeCacheKey || isAnalyzing || isCacheLoading) return;
    setErrorKey(null);
    setIsAnalyzing(true);
    setIsCancelling(false);
    let baseline = evaluations;
    if (replace) {
      await repository.clearAnalysis(game.fingerprint, engine, profileId);
      baseline = [];
      setEvaluationCache({ key: activeCacheKey, values: [], loading: false });
    }
    const present = new Set(baseline.map((evaluation) => evaluation.positionIndex));
    const positionIndexes = game.positions
      .map((_, index) => index)
      .filter((index) => !present.has(index));
    if (positionIndexes.length === 0) {
      setIsAnalyzing(false);
      return;
    }

    const analysisId = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`;
    analysisIdRef.current = analysisId;
    setProgress({ current: 0, total: positionIndexes.length });
    let unsubscribe: () => void = () => undefined;
    try {
      unsubscribe = await subscribeToAnalysisProgress((update) => {
        if (update.analysisId !== analysisId) return;
        setProgress({ current: update.current, total: update.total });
        setEvaluationCache((current) => current.key === activeCacheKey
          ? { ...current, values: upsertEvaluation(current.values, update.evaluation) }
          : current);
        void repository.saveEvaluations(
          game.fingerprint,
          engine,
          profileId,
          [update.evaluation],
        );
      });
      const response = await analyzePositions({
        analysisId,
        enginePath: engine.path,
        gameResult: game.result,
        depth: profile.depth,
        positions: game.positions,
        positionIndexes,
      });
      await repository.saveEvaluations(game.fingerprint, engine, profileId, response.evaluations);
      const stored = await repository.getAnalysis(game.fingerprint, engine, profileId);
      setEvaluationCache({ key: activeCacheKey, values: stored, loading: false });
      if (response.cancelled) setErrorKey("engineAnalysisCancelled");
    } catch (error) {
      setErrorKey(localizedEngineError(engineErrorCode(error)));
    } finally {
      unsubscribe();
      analysisIdRef.current = null;
      setIsAnalyzing(false);
      setIsCancelling(false);
      setProgress(null);
    }
  }, [activeCacheKey, engine, evaluations, game.fingerprint, game.positions, game.result, isAnalyzing, isCacheLoading, profile.depth, profileId, repository]);

  const stopAnalysis = useCallback(async () => {
    if (!analysisIdRef.current) return;
    setIsCancelling(true);
    await cancelAnalysis(analysisIdRef.current);
  }, []);

  const actionLabel = complete
    ? t("reAnalyze")
    : evaluations.length > 0
      ? t("resumeAnalysis")
      : t("analyze");

  const profileOptions = useMemo(() => ANALYSIS_PROFILES.map((item) => ({
    ...item,
    label: t(item.id === "quick" ? "profileQuick" : item.id === "deep" ? "profileDeep" : "profileBalanced"),
  })), [t]);

  return (
    <section className="engine-panel" aria-label={t("localAnalysis")}>
      <div className="engine-panel-heading">
        <div>
          <span className="eyebrow">{t("localAnalysis")}</span>
          <strong>{engine ? `${engine.name} · ${t("localOnly")}` : t("engineNotConfigured")}</strong>
        </div>
        <button className="text-button" onClick={() => void chooseEngine()} disabled={isAnalyzing}>
          {engine ? t("changeEngine") : t("chooseEngine")}
        </button>
      </div>

      <div className="engine-profile-row">
        <label htmlFor="analysis-profile">{t("analysisProfile")}</label>
        <select
          id="analysis-profile"
          value={profileId}
          disabled={isAnalyzing}
          onChange={(event) => void changeProfile(event.target.value as AnalysisProfileId)}
        >
          {profileOptions.map((item) => (
            <option key={item.id} value={item.id}>{item.label} · {t("depth", { count: item.depth })}</option>
          ))}
        </select>
      </div>

      <div className="evaluation-card" data-testid="position-evaluation">
        <span>{t("evaluation")}</span>
        <strong>{formatEvaluation(currentEvaluation)}</strong>
        <small>
          {currentEvaluation
            ? currentEvaluation.bestMove
              ? `${t("depth", { count: currentEvaluation.depth })} · ${t("bestMove")}: ${currentEvaluation.bestMove}`
              : `${t("depth", { count: currentEvaluation.depth })} · ${t("terminalPosition")}`
            : t("positionNotAnalyzed")}
        </small>
        {currentEvaluation?.pv.length ? (
          <code aria-label={t("bestVariation")}>{currentEvaluation.pv.join(" ")}</code>
        ) : null}
      </div>

      {progress ? (
        <div className="analysis-progress" aria-live="polite">
          <progress value={progress.current} max={progress.total} />
          <span>{t("analysisProgress", { current: progress.current, total: progress.total })}</span>
        </div>
      ) : (
        <p className="analysis-cache-status">
          {t("positionsAnalyzed", { current: evaluations.length, total: game.positions.length })}
        </p>
      )}

      {errorKey && <p className="engine-error" role="alert">{t(errorKey)}</p>}
      {engineStatus === "loading" && <p className="analysis-cache-status">{t("detectingEngine")}</p>}
      {engineStatus === "ready" && isCacheLoading ? (
        <p className="analysis-cache-status">{t("loadingAnalysisCache")}</p>
      ) : null}

      <div className="engine-actions">
        {isAnalyzing ? (
          <button className="danger-button" onClick={() => void stopAnalysis()} disabled={isCancelling}>
            {isCancelling ? t("cancelling") : t("cancelAnalysis")}
          </button>
        ) : (
          <button
            className="primary-button"
            onClick={() => void runAnalysis(complete)}
            disabled={!engine || engineStatus !== "ready" || isCacheLoading}
            title={!engine ? t("engineRequired") : undefined}
          >
            {actionLabel}
          </button>
        )}
        {complete && !isAnalyzing ? <small>{t("reAnalyzeHint")}</small> : null}
      </div>
    </section>
  );
}
