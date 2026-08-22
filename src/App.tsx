import { useCallback, useEffect, useMemo, useState } from "react";
import { AboutDialog } from "./components/AboutDialog";
import { ImportResultDialog } from "./components/ImportResultDialog";
import { LibraryScreen } from "./features/library/LibraryScreen";
import { ReviewScreen } from "./features/review/ReviewScreen";
import { useLanguage } from "./i18n/useLanguage";
import { createGameRepository } from "./lib/db/gameRepository";
import { parsePgnArchive } from "./lib/pgn/parsePgnArchive";
import { selectPgnArchive } from "./lib/pgn/selectPgnArchive";
import type { ImportSummary, StoredGame } from "./types";
import "./styles.css";

export default function App() {
  const { language, setLanguage, t } = useLanguage();
  const repository = useMemo(() => createGameRepository(), []);
  const [games, setGames] = useState<StoredGame[]>([]);
  const [selectedGame, setSelectedGame] = useState<StoredGame | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isImporting, setIsImporting] = useState(false);
  const [importSummary, setImportSummary] = useState<ImportSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showAbout, setShowAbout] = useState(false);

  const refreshGames = useCallback(async () => {
    setGames(await repository.listGames());
  }, [repository]);

  useEffect(() => {
    let active = true;
    repository.initialize()
      .then(() => repository.listGames())
      .then((storedGames) => {
        if (active) setGames(storedGames);
      })
      .catch(() => {
        if (active) setError(t("errorInitialization"));
      })
      .finally(() => {
        if (active) setIsLoading(false);
      });
    return () => { active = false; };
  }, [repository, t]);

  const handleImport = useCallback(async () => {
    setIsImporting(true);
    setError(null);
    try {
      const contents = await selectPgnArchive();
      if (contents === null) return;
      const parsed = parsePgnArchive(contents);
      const stored = await repository.addGames(parsed.games);
      await refreshGames();
      setImportSummary({ ...stored, rejections: parsed.rejections });
    } catch {
      setError(t("errorGeneric"));
    } finally {
      setIsImporting(false);
    }
  }, [refreshGames, repository, t]);

  return (
    <div className="app-frame">
      <nav className="topbar">
        <button className="brand" onClick={() => setSelectedGame(null)} aria-label={t("library")}>
          <span className="brand-mark" aria-hidden="true">♞</span>
          <span><strong>{t("appName")}</strong><small>{t("tagline")}</small></span>
        </button>
        <div className="topbar-actions">
          <div className="language-switcher" aria-label={t("language")}>
            <button className={language === "en" ? "active" : ""} onClick={() => setLanguage("en")}>EN</button>
            <button className={language === "fr" ? "active" : ""} onClick={() => setLanguage("fr")}>FR</button>
          </div>
          <button className="text-button" onClick={() => setShowAbout(true)}>{t("about")}</button>
        </div>
      </nav>

      {isLoading ? (
        <main className="loading-screen"><div className="loading-piece">♞</div><span>{t("appName")}</span></main>
      ) : selectedGame ? (
        <ReviewScreen game={selectedGame} onBack={() => setSelectedGame(null)} t={t} />
      ) : (
        <LibraryScreen games={games} isImporting={isImporting} onImport={handleImport} onOpenGame={setSelectedGame} t={t} />
      )}

      {error && (
        <div className="error-banner" role="alert">
          <strong>{t("errorTitle")}</strong><span>{error}</span>
          <button onClick={() => setError(null)} aria-label={t("close")}>×</button>
        </div>
      )}
      {importSummary && <ImportResultDialog summary={importSummary} onClose={() => setImportSummary(null)} t={t} />}
      {showAbout && <AboutDialog onClose={() => setShowAbout(false)} t={t} />}
    </div>
  );
}
