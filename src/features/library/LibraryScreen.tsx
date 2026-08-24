import type { StoredGame } from "../../types";
import type { TranslationKey } from "../../i18n/translations";
import type { GameRepository } from "../../lib/db/gameRepository";
import { ChessComImportPanel } from "../chess-com/ChessComImportPanel";

interface LibraryScreenProps {
  games: StoredGame[];
  isImporting: boolean;
  onImport: () => void;
  onOpenGame: (game: StoredGame) => void;
  repository: GameRepository;
  onGamesChanged: () => Promise<void>;
  t: (key: TranslationKey, variables?: Record<string, string | number>) => string;
}

export function LibraryScreen({
  games,
  isImporting,
  onImport,
  onOpenGame,
  repository,
  onGamesChanged,
  t,
}: LibraryScreenProps) {
  return (
    <main className="page-shell library-page">
      <section className="library-heading">
        <div>
          <p className="eyebrow">{t("localPrivate")}</p>
          <h1>{t("library")}</h1>
          <p>{t("localPrivateDetail")}</p>
        </div>
        <button className="primary-button" onClick={onImport} disabled={isImporting}>
          <span aria-hidden="true">＋</span>
          {isImporting ? t("importing") : t("importPgn")}
        </button>
      </section>

      <ChessComImportPanel
        repository={repository}
        onGamesChanged={onGamesChanged}
        t={t}
      />

      {games.length === 0 ? (
        <section className="empty-state">
          <div className="empty-knight" aria-hidden="true">♞</div>
          <h2>{t("emptyTitle")}</h2>
          <p>{t("emptyBody")}</p>
          <span>{t("emptyHint")}</span>
          <button className="primary-button" onClick={onImport} disabled={isImporting}>
            {isImporting ? t("importing") : t("importPgn")}
          </button>
        </section>
      ) : (
        <section className="game-library" aria-label={t("library")}>
          <div className="library-count">
            <strong>{games.length}</strong> {t("games")}
          </div>
          <div className="game-table" role="table">
            <div className="game-row game-table-header" role="row">
              <span role="columnheader">{t("white")}</span>
              <span role="columnheader">{t("black")}</span>
              <span role="columnheader">{t("result")}</span>
              <span role="columnheader">{t("date")}</span>
              <span role="columnheader">{t("timeControl")}</span>
              <span role="columnheader">{t("source")}</span>
              <span aria-hidden="true" />
            </div>
            {games.map((game) => (
              <div
                className="game-row game-table-item"
                key={game.fingerprint}
                role="row"
                tabIndex={0}
                onDoubleClick={() => onOpenGame(game)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") onOpenGame(game);
                }}
              >
                <strong role="cell">{game.white}</strong>
                <strong role="cell">{game.black}</strong>
                <span className="result-pill" role="cell">{game.result}</span>
                <span role="cell">{game.displayDate ?? t("unknown")}</span>
                <span role="cell">{game.timeControl ?? "—"}</span>
                <span className="source-cell" role="cell">{game.source ?? "—"}</span>
                <button
                  className="icon-button row-open-button"
                  onClick={() => onOpenGame(game)}
                  aria-label={`${t("openGame")}: ${game.white} – ${game.black}`}
                >
                  →
                </button>
              </div>
            ))}
          </div>
        </section>
      )}
    </main>
  );
}
