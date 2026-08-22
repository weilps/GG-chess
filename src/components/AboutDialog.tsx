import type { TranslationKey } from "../i18n/translations";

interface AboutDialogProps {
  onClose: () => void;
  t: (key: TranslationKey) => string;
}

export function AboutDialog({ onClose, t }: AboutDialogProps) {
  return (
    <div className="dialog-backdrop" role="presentation" onMouseDown={onClose}>
      <section className="dialog-card about-card" role="dialog" aria-modal="true" aria-labelledby="about-title" onMouseDown={(event) => event.stopPropagation()}>
        <div className="brand-mark large" aria-hidden="true">♞</div>
        <h2 id="about-title">{t("appName")}</h2>
        <p>{t("creditText")}</p>
        <a href="https://encroissant.org" target="_blank" rel="noreferrer">En Croissant</a>
        <button className="primary-button" onClick={onClose}>{t("close")}</button>
      </section>
    </div>
  );
}
