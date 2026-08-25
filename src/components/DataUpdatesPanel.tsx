import { isTauri } from "@tauri-apps/api/core";
import { useEffect, useRef, useState } from "react";
import type { TranslationKey } from "../i18n/translations";
import type { GameRepository } from "../lib/db/gameRepository";
import {
  currentAppVersion,
  restorePortableBackup,
  savePgnExport,
  savePortableBackup,
} from "../lib/data/dataFileClient";
import {
  checkForChessMateUpdate,
  restartChessMate,
  type AvailableUpdate,
  UpdateError,
} from "../lib/data/updaterClient";
import type { Language, StoredGame } from "../types";

interface DataUpdatesPanelProps {
  games: StoredGame[];
  repository: GameRepository;
  language: Language;
  onRestored: (language: Language | undefined) => Promise<void>;
  t: (key: TranslationKey, variables?: Record<string, string | number>) => string;
}

export function DataUpdatesPanel({
  games,
  repository,
  language,
  onRestored,
  t,
}: DataUpdatesPanelProps) {
  const desktop = isTauri();
  const [version, setVersion] = useState("0.1.0");
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState(false);
  const [availableUpdate, setAvailableUpdate] = useState<AvailableUpdate | null>(null);
  const availableUpdateRef = useRef<AvailableUpdate | null>(null);
  const [updateProgress, setUpdateProgress] = useState<string | null>(null);
  const [updateInstalled, setUpdateInstalled] = useState(false);

  useEffect(() => {
    void currentAppVersion().then(setVersion).catch(() => undefined);
  }, []);

  useEffect(() => () => {
    void availableUpdateRef.current?.close().catch(() => undefined);
  }, []);

  async function run(action: string, callback: () => Promise<void>) {
    setBusy(action);
    setMessage(null);
    setError(false);
    try {
      await callback();
    } catch (cause) {
      setError(true);
      setMessage(t(cause instanceof UpdateError
        ? cause.code === "offline" ? "updateOffline" : "updateInvalid"
        : "dataActionError"));
    } finally {
      setBusy(null);
    }
  }

  function backup() {
    void run("backup", async () => {
      const result = await savePortableBackup(repository, language);
      if (!result.canceled) setMessage(t("backupDone", { count: result.games }));
    });
  }

  function restore() {
    if (!window.confirm(t("restoreConfirm"))) return;
    void run("restore", async () => {
      const result = await restorePortableBackup(repository);
      if (result.canceled) return;
      await onRestored(result.language);
      setMessage(t("restoreDone", {
        added: result.added,
        updated: result.updated,
        unchanged: result.unchanged,
        rejected: result.rejected,
      }));
    });
  }

  function exportPgn() {
    void run("pgn", async () => {
      const result = await savePgnExport(games);
      if (!result.canceled) setMessage(result.games > 0
        ? t("pgnExportDone", { count: result.games })
        : t("pgnExportEmpty"));
    });
  }

  function checkForUpdates() {
    void run("check", async () => {
      const previousUpdate = availableUpdateRef.current;
      availableUpdateRef.current = null;
      setAvailableUpdate(null);
      setUpdateInstalled(false);
      setUpdateProgress(null);
      await previousUpdate?.close();
      const update = await checkForChessMateUpdate();
      availableUpdateRef.current = update;
      setAvailableUpdate(update);
      setMessage(update
        ? t("updateAvailable", { version: update.version })
        : t("updateCurrent"));
    });
  }

  function installUpdate() {
    if (!availableUpdate || !window.confirm(t("updateInstallConfirm", {
      version: availableUpdate.version,
    }))) return;
    void run("install", async () => {
      await availableUpdate.downloadAndInstall((downloaded, total) => {
        const progress = total && total > 0
          ? `${Math.min(100, Math.round(downloaded / total * 100))}%`
          : `${Math.round(downloaded / 1024)} KB`;
        setUpdateProgress(t("updateProgress", { progress }));
      });
      setUpdateInstalled(true);
      setMessage(t("updateInstalled"));
    });
  }

  function restart() {
    if (!window.confirm(t("restartConfirm"))) return;
    void run("restart", restartChessMate);
  }

  return (
    <section className="data-updates" aria-labelledby="data-updates-title">
      <div className="data-updates-heading">
        <div>
          <p className="eyebrow">{t("stableChannel")}</p>
          <h3 id="data-updates-title">{t("dataUpdates")}</h3>
        </div>
        <span>{t("versionLabel", { version })}</span>
      </div>

      <p>{t("backupPrivacy")}</p>
      <div className="data-action-grid">
        <button disabled={!desktop || busy !== null} onClick={backup}>
          {busy === "backup" ? t("backingUp") : t("backupData")}
        </button>
        <button disabled={!desktop || busy !== null} onClick={restore}>
          {busy === "restore" ? t("restoring") : t("restoreData")}
        </button>
        <button disabled={!desktop || busy !== null} onClick={exportPgn}>
          {busy === "pgn" ? t("exporting") : t("exportPgn")}
        </button>
      </div>

      <div className="update-area">
        <p>{t("updatePrivacy")}</p>
        <button className="primary-button" disabled={!desktop || busy !== null} onClick={checkForUpdates}>
          {busy === "check" ? t("checkingUpdates") : t("checkUpdates")}
        </button>
        {availableUpdate && !updateInstalled && (
          <div className="available-update">
            {availableUpdate.notes && <small>{availableUpdate.notes}</small>}
            <button disabled={busy !== null} onClick={installUpdate}>
              {busy === "install" ? t("installingUpdate") : t("downloadInstall")}
            </button>
          </div>
        )}
        {updateInstalled && <button onClick={restart}>{t("restartNow")}</button>}
        {updateProgress && <small>{updateProgress}</small>}
      </div>

      {!desktop && <small>{t("desktopDataOnly")}</small>}
      <small>{t("unsignedBuildNotice")}</small>
      {message && <p className={error ? "data-status error" : "data-status"} role={error ? "alert" : "status"}>{message}</p>}
    </section>
  );
}
