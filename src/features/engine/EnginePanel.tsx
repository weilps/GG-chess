import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { TranslationKey } from "../../i18n/translations";
import type { GameRepository } from "../../lib/db/gameRepository";
import type {
  AnalysisProfileId,
  AnalysisSnapshot,
  EngineInfo,
  GuidanceMode,
  MoveNotationMode,
  MultiPv,
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
  compact?: boolean;
  game: StoredGame;
  positionIndex: number;
  repository: GameRepository;
  t: (key: TranslationKey, variables?: Record<string, string | number>) => string;
  onAnalysisStateChange?: (snapshot: AnalysisSnapshot) => void;
  moveNotation?: MoveNotationMode;
  onMoveNotationChange?: (mode: MoveNotationMode) => void;
}

function GearIcon() {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
      <path
        d="M12 8.6a3.4 3.4 0 1 0 0 6.8 3.4 3.4 0 0 0 0-6.8Zm8 3.4-2.05-1.18.04-.82-.04-.82L20 8l-2-3.46-2.05 1.18a7.3 7.3 0 0 0-1.42-.82V2.54h-4V4.9c-.5.22-.98.5-1.42.82L7.06 4.54 5.06 8l2.05 1.18-.04.82.04.82L5.06 12l2 3.46 2.05-1.18c.44.33.92.6 1.42.82v2.36h4V15.1c.5-.22.98-.5 1.42-.82L18 15.46 20 12Z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
      <path d="m7 7 10 10M17 7 7 17" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
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
  if (code.includes("cache")) return "engineErrorCache";
  return "engineErrorUnknown";
}

export function EnginePanel({
  compact = false,
  game,
  positionIndex,
  repository,
  t,
  onAnalysisStateChange,
  moveNotation = "pieces",
  onMoveNotationChange,
}: EnginePanelProps) {
  const [engine, setEngine] = useState<EngineInfo | null>(null);
  const [engineStatus, setEngineStatus] = useState<EngineStatus>("loading");
  const [profileId, setProfileId] = useState<AnalysisProfileId>("balanced");
  const [multiPv, setMultiPv] = useState<MultiPv>(1);
  const [guidanceEnabled, setGuidanceEnabled] = useState(true);
  const [guidanceMode, setGuidanceMode] = useState<GuidanceMode>("next");
  const [settingsLoaded, setSettingsLoaded] = useState(false);
  const [evaluationCache, setEvaluationCache] = useState<EvaluationCacheState>({
    key: null,
    values: [],
    loading: true,
  });
  const [progress, setProgress] = useState<{ current: number; total: number } | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [isCancelling, setIsCancelling] = useState(false);
  const [errorKey, setErrorKey] = useState<TranslationKey | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const analysisIdRef = useRef<string | null>(null);
  const settingsButtonRef = useRef<HTMLButtonElement | null>(null);
  const settingsCloseRef = useRef<HTMLButtonElement | null>(null);
  const settingsWrapRef = useRef<HTMLDivElement | null>(null);
  const exposeError = useCallback((key: TranslationKey) => {
    setErrorKey(key);
    if (compact) setSettingsOpen(true);
  }, [compact]);

  const profile = ANALYSIS_PROFILES.find((item) => item.id === profileId) ?? ANALYSIS_PROFILES[1];
  const activeCacheKey = engine
    ? [game.fingerprint, engine.name, engine.version, profileId, multiPv].join("\u0000")
    : null;
  const evaluations = useMemo(
    () => evaluationCache.key === activeCacheKey ? evaluationCache.values : [],
    [activeCacheKey, evaluationCache],
  );
  const isCacheLoading = activeCacheKey !== null
    && (evaluationCache.key !== activeCacheKey || evaluationCache.loading);
  const displayedPositionIndex = guidanceMode === "compare" && positionIndex > 0
    ? positionIndex - 1
    : positionIndex;
  const currentEvaluation = evaluations.find((item) => item.positionIndex === displayedPositionIndex);
  const complete = evaluations.length === game.positions.length;

  useEffect(() => {
    onAnalysisStateChange?.({
      cacheKey: activeCacheKey,
      evaluations,
      engineStatus,
      loading: isCacheLoading || !settingsLoaded,
      profile: profileId,
      multiPv,
      guidanceEnabled,
      guidanceMode,
    });
  }, [activeCacheKey, engineStatus, evaluations, guidanceEnabled, guidanceMode, isCacheLoading, multiPv, onAnalysisStateChange, profileId, settingsLoaded]);

  useEffect(() => {
    let active = true;
    Promise.all([
      repository.getSetting("analysisProfile"),
      repository.getSetting("analysisMultiPv"),
      repository.getSetting("guidanceEnabled"),
      repository.getSetting("guidanceMode"),
    ])
      .then(([savedProfile, savedMultiPv, savedGuidanceEnabled, savedGuidanceMode]) => {
        if (active && ANALYSIS_PROFILES.some((item) => item.id === savedProfile)) {
          setProfileId(savedProfile as AnalysisProfileId);
        }
        const parsedMultiPv = Number(savedMultiPv);
        if (active && (parsedMultiPv === 1 || parsedMultiPv === 2 || parsedMultiPv === 3)) {
          setMultiPv(parsedMultiPv);
        }
        if (active && savedGuidanceEnabled !== null) {
          setGuidanceEnabled(savedGuidanceEnabled !== "false");
        }
        if (active && (savedGuidanceMode === "next" || savedGuidanceMode === "compare")) {
          setGuidanceMode(savedGuidanceMode);
        }
      })
      .catch(() => undefined)
      .finally(() => {
        if (active) setSettingsLoaded(true);
      });
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
    repository.getAnalysis(game.fingerprint, engine, profileId, multiPv)
      .then((stored) => {
        if (active) {
          setEvaluationCache({ key: activeCacheKey, values: stored, loading: false });
        }
      })
      .catch(() => {
        if (active) {
          setEvaluationCache({ key: activeCacheKey, values: [], loading: false });
          exposeError("engineErrorCache");
        }
      });
    return () => { active = false; };
  }, [activeCacheKey, engine, exposeError, game.fingerprint, multiPv, profileId, repository]);

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
        engineStatus: "ready",
        loading: true,
        profile: profileId,
        multiPv,
        guidanceEnabled,
        guidanceMode,
      });
      setEngine(selected);
      setEngineStatus("ready");
    } catch (error) {
      setEngineStatus("error");
      exposeError(localizedEngineError(engineErrorCode(error)));
    }
  }, [exposeError, guidanceEnabled, guidanceMode, multiPv, onAnalysisStateChange, profileId, repository]);

  const changeProfile = useCallback(async (next: AnalysisProfileId) => {
    onAnalysisStateChange?.({
      cacheKey: null,
      evaluations: [],
      engineStatus: "ready",
      loading: true,
      profile: next,
      multiPv,
      guidanceEnabled,
      guidanceMode,
    });
    setProfileId(next);
    await repository.setSetting("analysisProfile", next);
  }, [guidanceEnabled, guidanceMode, multiPv, onAnalysisStateChange, repository]);

  const changeMultiPv = useCallback(async (next: MultiPv) => {
    onAnalysisStateChange?.({
      cacheKey: null,
      evaluations: [],
      engineStatus: "ready",
      loading: true,
      profile: profileId,
      multiPv: next,
      guidanceEnabled,
      guidanceMode,
    });
    setMultiPv(next);
    await repository.setSetting("analysisMultiPv", String(next));
  }, [guidanceEnabled, guidanceMode, onAnalysisStateChange, profileId, repository]);

  const changeGuidanceEnabled = useCallback(async (enabled: boolean) => {
    setGuidanceEnabled(enabled);
    await repository.setSetting("guidanceEnabled", String(enabled));
  }, [repository]);

  const changeGuidanceMode = useCallback(async (mode: GuidanceMode) => {
    setGuidanceMode(mode);
    await repository.setSetting("guidanceMode", mode);
  }, [repository]);

  const runAnalysis = useCallback(async (replace: boolean) => {
    if (!engine || !activeCacheKey || isAnalyzing || isCacheLoading) return;
    setErrorKey(null);
    setIsAnalyzing(true);
    setIsCancelling(false);
    const baseline = replace ? [] : evaluations;
    onAnalysisStateChange?.({
      cacheKey: null,
      evaluations: [],
      engineStatus: "ready",
      loading: true,
      profile: profileId,
      multiPv,
      guidanceEnabled,
      guidanceMode,
    });
    setEvaluationCache({ key: activeCacheKey, values: baseline, loading: true });
    let unsubscribe: () => void = () => undefined;
    try {
      if (replace) {
        try {
          await repository.clearAnalysis(game.fingerprint, engine, profileId, multiPv);
        } catch {
          throw new Error("engine_cache");
        }
      }
      const present = new Set(baseline.map((evaluation) => evaluation.positionIndex));
      const positionIndexes = game.positions
        .map((_, index) => index)
        .filter((index) => !present.has(index));
      if (positionIndexes.length === 0) return;

      const analysisId = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`;
      analysisIdRef.current = analysisId;
      setProgress({ current: 0, total: positionIndexes.length });
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
          multiPv,
          [update.evaluation],
        );
      });
      const response = await analyzePositions({
        analysisId,
        enginePath: engine.path,
        gameResult: game.result,
        depth: profile.depth,
        multiPv,
        positions: game.positions,
        positionIndexes,
      });
      await repository.saveEvaluations(game.fingerprint, engine, profileId, multiPv, response.evaluations);
      const stored = await repository.getAnalysis(game.fingerprint, engine, profileId, multiPv);
      setEvaluationCache({ key: activeCacheKey, values: stored, loading: false });
      if (response.cancelled) exposeError("engineAnalysisCancelled");
    } catch (error) {
      exposeError(localizedEngineError(engineErrorCode(error)));
    } finally {
      unsubscribe();
      analysisIdRef.current = null;
      setEvaluationCache((current) => current.key === activeCacheKey
        ? { ...current, loading: false }
        : current);
      setIsAnalyzing(false);
      setIsCancelling(false);
      setProgress(null);
    }
  }, [activeCacheKey, engine, evaluations, exposeError, game.fingerprint, game.positions, game.result, guidanceEnabled, guidanceMode, isAnalyzing, isCacheLoading, multiPv, onAnalysisStateChange, profile.depth, profileId, repository]);

  const stopAnalysis = useCallback(async () => {
    if (!analysisIdRef.current) return;
    setIsCancelling(true);
    await cancelAnalysis(analysisIdRef.current);
  }, []);

  const closeSettings = useCallback((deferFocus = false) => {
    setSettingsOpen(false);
    const restoreFocus = () => settingsButtonRef.current?.focus();
    if (deferFocus) {
      window.requestAnimationFrame(restoreFocus);
    } else {
      restoreFocus();
    }
  }, []);

  useEffect(() => {
    if (!settingsOpen) return;
    const focusFrame = window.requestAnimationFrame(() => settingsCloseRef.current?.focus());
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        closeSettings();
      }
    };
    const handlePointerDown = (event: PointerEvent) => {
      if (!settingsWrapRef.current?.contains(event.target as Node)) closeSettings(true);
    };
    window.addEventListener("keydown", handleKeyDown);
    document.addEventListener("pointerdown", handlePointerDown);
    return () => {
      window.cancelAnimationFrame(focusFrame);
      window.removeEventListener("keydown", handleKeyDown);
      document.removeEventListener("pointerdown", handlePointerDown);
    };
  }, [closeSettings, settingsOpen]);

  const actionLabel = complete
    ? t("reAnalyze")
    : evaluations.length > 0
      ? t("resumeAnalysis")
      : t("analyze");

  const profileOptions = useMemo(() => ANALYSIS_PROFILES.map((item) => ({
    ...item,
    label: t(item.id === "quick" ? "profileQuick" : item.id === "deep" ? "profileDeep" : "profileBalanced"),
  })), [t]);

  const settingsContent = (
    <>
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
        <label htmlFor={compact ? "analysis-profile-compact" : "analysis-profile"}>{t("analysisProfile")}</label>
        <select
          id={compact ? "analysis-profile-compact" : "analysis-profile"}
          value={profileId}
          disabled={isAnalyzing}
          onChange={(event) => void changeProfile(event.target.value as AnalysisProfileId)}
        >
          {profileOptions.map((item) => (
            <option key={item.id} value={item.id}>{item.label} · {t("depth", { count: item.depth })}</option>
          ))}
        </select>
      </div>

      <fieldset className="guidance-settings">
        <legend>{t("guidanceSettings")}</legend>
        <label className="guidance-toggle">
          <input
            type="checkbox"
            checked={guidanceEnabled}
            onChange={(event) => void changeGuidanceEnabled(event.target.checked)}
          />
          <span>{t("guidanceEnabled")}</span>
        </label>
        <label className="guidance-mode-control" htmlFor={compact ? "guidance-mode-compact" : "guidance-mode"}>
          <span>{t("guidanceMode")}</span>
          <select
            id={compact ? "guidance-mode-compact" : "guidance-mode"}
            value={guidanceMode}
            disabled={!guidanceEnabled}
            onChange={(event) => void changeGuidanceMode(event.target.value as GuidanceMode)}
          >
            <option value="next">{t("guidanceModeNext")}</option>
            <option value="compare">{t("guidanceModeCompare")}</option>
          </select>
        </label>
        <small>{t("guidanceLegend")}</small>
      </fieldset>

      <div className="engine-profile-row">
        <label htmlFor={compact ? "move-notation-compact" : "move-notation"}>{t("moveNotation")}</label>
        <select
          id={compact ? "move-notation-compact" : "move-notation"}
          value={moveNotation}
          onChange={(event) => onMoveNotationChange?.(event.target.value as MoveNotationMode)}
        >
          <option value="pieces">{t("moveNotationPiecesSan")}</option>
          <option value="san">{t("moveNotationSanOnly")}</option>
        </select>
      </div>

      <div className="engine-profile-row">
        <label htmlFor={compact ? "analysis-lines-compact" : "analysis-lines"}>{t("analysisLines")}</label>
        <select
          id={compact ? "analysis-lines-compact" : "analysis-lines"}
          value={multiPv}
          disabled={isAnalyzing}
          onChange={(event) => void changeMultiPv(Number(event.target.value) as MultiPv)}
        >
          {[1, 2, 3].map((count) => (
            <option key={count} value={count}>
              {count === 1 ? t("analysisLineSingle") : t("analysisLinePlural", { count })}
            </option>
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
      {engineStatus === "ready" && !isCacheLoading && evaluations.length === 0 ? (
        <p className="analysis-required-message" role="status">
          {t("analysisRequiredForLines", { count: multiPv })}
        </p>
      ) : null}
    </>
  );

  if (compact) {
    return (
      <div className="engine-compact-controls" aria-label={t("localAnalysis")}>
        <div className="engine-header-action">
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
          {progress ? (
            <span className="engine-header-progress" aria-live="polite">
              {progress.current}/{progress.total}
            </span>
          ) : null}
        </div>
        <div className="engine-settings-wrap" ref={settingsWrapRef}>
          <button
            ref={settingsButtonRef}
            className={`review-icon-button${errorKey ? " engine-settings-error" : ""}`}
            aria-expanded={settingsOpen}
            aria-haspopup="dialog"
            aria-label={errorKey ? `${t("settings")}: ${t(errorKey)}` : t("settings")}
            title={errorKey ? t(errorKey) : t("settings")}
            onClick={() => setSettingsOpen((open) => !open)}
          >
            <GearIcon />
            {errorKey ? <span className="engine-settings-error-dot" aria-hidden="true" /> : null}
          </button>
          {settingsOpen ? (
            <section className="engine-settings-popover" role="dialog" aria-label={t("localAnalysis")}>
              <button
                ref={settingsCloseRef}
                className="engine-settings-close"
                onClick={() => closeSettings()}
                aria-label={t("close")}
                title={t("close")}
              >
                <CloseIcon />
              </button>
              {settingsContent}
              {complete && !isAnalyzing ? <small className="engine-settings-hint">{t("reAnalyzeHint")}</small> : null}
            </section>
          ) : null}
        </div>
      </div>
    );
  }

  return (
    <section className="engine-panel" aria-label={t("localAnalysis")}>
      {settingsContent}

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
