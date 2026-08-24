import type { TranslationKey } from "../i18n/translations";
import type { GameRepository } from "../lib/db/gameRepository";
import type { Language, StoredGame } from "../types";
import { DataUpdatesPanel } from "./DataUpdatesPanel";

interface AboutDialogProps {
  games: StoredGame[];
  repository: GameRepository;
  language: Language;
  onRestored: (language: Language | undefined) => Promise<void>;
  onClose: () => void;
  t: (key: TranslationKey, variables?: Record<string, string | number>) => string;
}

export function AboutDialog({ games, repository, language, onRestored, onClose, t }: AboutDialogProps) {
  return (
    <div className="dialog-backdrop" role="presentation" onMouseDown={onClose}>
      <section className="dialog-card about-card" role="dialog" aria-modal="true" aria-labelledby="about-title" onMouseDown={(event) => event.stopPropagation()}>
        <div className="brand-mark large" aria-hidden="true">♞</div>
        <h2 id="about-title">{t("appName")}</h2>
        <p>{t("creditText")}</p>
        <a href="https://encroissant.org" target="_blank" rel="noreferrer">En Croissant</a>
        <DataUpdatesPanel
          games={games}
          repository={repository}
          language={language}
          onRestored={onRestored}
          t={t}
        />
        <button className="primary-button" onClick={onClose}>{t("close")}</button>
      </section>
    </div>
  );
}
