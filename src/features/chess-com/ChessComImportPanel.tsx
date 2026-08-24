import { useEffect, useRef, useState } from "react";
import type { TranslationKey } from "../../i18n/translations";
import type { GameRepository } from "../../lib/db/gameRepository";
import {
  ChessComSyncError,
  chessComImportAvailable,
  getSavedChessComUsername,
  syncChessComGames,
  type ChessComSyncProgress,
  type ChessComSyncSummary,
} from "./chessComClient";

interface ChessComImportPanelProps {
  repository: GameRepository;
  onGamesChanged: () => Promise<void>;
  t: (key: TranslationKey, variables?: Record<string, string | number>) => string;
}

export function ChessComImportPanel({
  repository,
  onGamesChanged,
  t,
}: ChessComImportPanelProps) {
  const nativeAvailable = chessComImportAvailable();
  const cancelRequested = useRef(false);
  const [username, setUsername] = useState("");
  const [isSyncing, setIsSyncing] = useState(false);
  const [progress, setProgress] = useState<ChessComSyncProgress | null>(null);
  const [summary, setSummary] = useState<ChessComSyncSummary | null>(null);
  const [errorKey, setErrorKey] = useState<TranslationKey | null>(null);
  const [partial, setPartial] = useState(false);

  useEffect(() => {
    let active = true;
    getSavedChessComUsername(repository)
      .then((saved) => { if (active) setUsername(saved); })
      .catch(() => undefined);
    return () => { active = false; };
  }, [repository]);

  async function handleSync(event: React.FormEvent) {
    event.preventDefault();
    if (!nativeAvailable || isSyncing) return;
    cancelRequested.current = false;
    setIsSyncing(true);
    setSummary(null);
    setErrorKey(null);
    setPartial(false);
    try {
      const result = await syncChessComGames({
        username,
        repository,
        isCancelled: () => cancelRequested.current,
        onProgress: setProgress,
      });
      setSummary(result);
      await onGamesChanged();
    } catch (error) {
      if (error instanceof ChessComSyncError) {
        setSummary(error.summary);
        setPartial(error.summary.monthsChecked > 0);
        setErrorKey(errorTranslationKey(error.causeCode));
        await onGamesChanged();
      } else {
        setErrorKey(errorTranslationKey(error));
      }
    } finally {
      setProgress(null);
      setIsSyncing(false);
    }
  }

  return (
    <section className="chess-com-import" aria-labelledby="chess-com-import-title">
      <div className="chess-com-copy">
        <p className="eyebrow">Chess.com</p>
        <h2 id="chess-com-import-title">{t("chessComImport")}</h2>
        <p>{t("chessComImportDetail")}</p>
        <small>{t("chessComPrivacy")}</small>
      </div>
      <div className="chess-com-controls">
        {!nativeAvailable ? (
          <p className="chess-com-unavailable">{t("chessComWindowsOnly")}</p>
        ) : (
          <form onSubmit={handleSync}>
            <label htmlFor="chess-com-username">{t("chessComUsername")}</label>
            <div>
              <input
                id="chess-com-username"
                value={username}
                onChange={(event) => setUsername(event.target.value)}
                placeholder={t("chessComUsernamePlaceholder")}
                autoComplete="username"
                disabled={isSyncing}
              />
              <button className="primary-button" type="submit" disabled={isSyncing || !username.trim()}>
                {isSyncing ? t("chessComSyncing") : t("chessComSync")}
              </button>
              {isSyncing && (
                <button
                  className="secondary-button"
                  type="button"
                  onClick={() => { cancelRequested.current = true; }}
                >
                  {t("chessComCancel")}
                </button>
              )}
            </div>
          </form>
        )}
        {progress && (
          <div className="chess-com-progress" aria-live="polite">
            <progress value={progress.current} max={progress.total} />
            <span>{t("chessComProgress", {
              month: progress.yearMonth,
              current: progress.current,
              total: progress.total,
            })}</span>
          </div>
        )}
        {errorKey && (
          <div className="chess-com-error" role="alert">
            {partial && <strong>{t("chessComPartial")}</strong>}
            <span>{t(errorKey)}</span>
          </div>
        )}
        {summary && <ChessComSummary summary={summary} t={t} />}
        <p className="chess-com-attribution">
          {t("chessComAttribution")}{" "}
          <a href="https://www.chess.com/news/view/published-data-api" target="_blank" rel="noreferrer">
            {t("chessComApiLink")}
          </a>
        </p>
      </div>
    </section>
  );
}

function ChessComSummary({
  summary,
  t,
}: {
  summary: ChessComSyncSummary;
  t: ChessComImportPanelProps["t"];
}) {
  return (
    <div className="chess-com-summary" aria-live="polite">
      <strong>{summary.cancelled ? t("chessComCancelled") : t("chessComComplete")}</strong>
      <div>
        <span>{t("chessComAdded", { count: summary.added })}</span>
        <span>{t("chessComDuplicates", { count: summary.duplicates })}</span>
        <span>{t("chessComRejected", { count: summary.rejections.length })}</span>
        <span>{t("chessComVariants", { count: summary.variantsIgnored })}</span>
        <span>{t("chessComMonthsChecked", { count: summary.monthsChecked })}</span>
        <span>{t("chessComMonthsUnchanged", { count: summary.monthsUnchanged })}</span>
      </div>
    </div>
  );
}

function errorTranslationKey(error: unknown): TranslationKey {
  const code = error instanceof Error ? error.message : String(error);
  const mapping: Record<string, TranslationKey> = {
    chess_com_invalid_username: "chessComErrorUsername",
    chess_com_not_found: "chessComErrorNotFound",
    chess_com_gone: "chessComErrorGone",
    chess_com_rate_limited: "chessComErrorRateLimited",
    chess_com_timeout: "chessComErrorTimeout",
    chess_com_offline: "chessComErrorOffline",
    chess_com_redirected: "chessComErrorRedirected",
    chess_com_invalid_month: "chessComErrorResponse",
    chess_com_invalid_response: "chessComErrorResponse",
    chess_com_response_too_large: "chessComErrorResponse",
    chess_com_invalid_cache: "chessComErrorResponse",
  };
  return mapping[code] ?? "chessComErrorGeneric";
}
