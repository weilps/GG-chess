import type { ImportSummary } from "../types";
import type { TranslationKey } from "../i18n/translations";

interface ImportResultDialogProps {
  summary: ImportSummary;
  onClose: () => void;
  t: (key: TranslationKey, variables?: Record<string, string | number>) => string;
}

export function ImportResultDialog({ summary, onClose, t }: ImportResultDialogProps) {
  return (
    <div className="dialog-backdrop" role="presentation" onMouseDown={onClose}>
      <section className="dialog-card" role="dialog" aria-modal="true" aria-labelledby="import-title" onMouseDown={(event) => event.stopPropagation()}>
        <div className="dialog-icon" aria-hidden="true">✓</div>
        <h2 id="import-title">{t("importComplete")}</h2>
        <div className="import-stats">
          <span className="stat-added">{t("importAdded", { count: summary.added })}</span>
          <span>{t("importDuplicates", { count: summary.duplicates })}</span>
          <span className={summary.rejections.length ? "stat-rejected" : ""}>{t("importRejected", { count: summary.rejections.length })}</span>
        </div>
        {summary.rejections.length > 0 && (
          <div className="rejection-list">
            <strong>{t("rejectionDetails")}</strong>
            {summary.rejections.map((rejection) => (
              <p key={`${rejection.gameNumber}-${rejection.reason}`}>
                #{rejection.gameNumber} — {t(
                  rejection.reason === "emptyFile"
                    ? "rejectionEmptyFile"
                    : rejection.reason === "unsupportedVariant"
                      ? "rejectionUnsupportedVariant"
                      : "rejectionInvalidPgn",
                  { detail: rejection.detail ?? t("unknown") },
                )}
              </p>
            ))}
          </div>
        )}
        <button className="primary-button" onClick={onClose}>{t("close")}</button>
      </section>
    </div>
  );
}
