import { useEffect, useMemo, useState } from "react";
import type { TranslationKey } from "../../i18n/translations";
import type {
  GameRepository,
  PuzzleProgress,
  PuzzleResult,
  StoredAnalysisCache,
  TrainingActivity,
} from "../../lib/db/gameRepository";
import type { StoredGame } from "../../types";
import { TrainingPuzzle } from "./TrainingPuzzle";
import {
  buildOpeningRepertoire,
  buildPlayerTrends,
  buildQuestProgress,
  buildTrainingPuzzles,
  calculateTrainingStreak,
  makeTrainingActivity,
  orderRevengePuzzles,
  parsePlayerAliases,
  updatePuzzleProgress,
  weekStartMonday,
  type CoachProfileId,
  type OpeningLine,
  type PlayerSide,
} from "./trainingData";

const PLAYER_SETTING = "trainingPlayerNames";
const COACH_SETTING = "trainingCoachProfile";

interface TrainingScreenProps {
  games: StoredGame[];
  repository: GameRepository;
  onBack: () => void;
  t: (key: TranslationKey, variables?: Record<string, string | number>) => string;
}

export function TrainingScreen({ games, repository, onBack, t }: TrainingScreenProps) {
  const [loading, setLoading] = useState(true);
  const [caches, setCaches] = useState<StoredAnalysisCache[]>([]);
  const [progress, setProgress] = useState<PuzzleProgress[]>([]);
  const [activities, setActivities] = useState<TrainingActivity[]>([]);
  const [trainingDays, setTrainingDays] = useState<string[]>([]);
  const [playerNames, setPlayerNames] = useState("");
  const [coachProfile, setCoachProfile] = useState<CoachProfileId>("calm");
  const [activePuzzleKey, setActivePuzzleKey] = useState<string | null>(null);
  const [puzzleRound, setPuzzleRound] = useState(0);
  const [openingFilter, setOpeningFilter] = useState<"all" | PlayerSide>("all");
  const [selectedOpening, setSelectedOpening] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [storageError, setStorageError] = useState(false);

  useEffect(() => {
    let active = true;
    const now = new Date();
    Promise.all([
      repository.listAnalysisCaches(),
      repository.listPuzzleProgress(),
      repository.listTrainingActivities(weekStartMonday(now)),
      repository.listTrainingDays(),
      repository.getSetting(PLAYER_SETTING),
      repository.getSetting(COACH_SETTING),
      repository.getSetting("chessComUsername"),
    ]).then(([savedCaches, savedProgress, savedActivities, days, names, profile, chessComName]) => {
      if (!active) return;
      setCaches(savedCaches);
      setProgress(savedProgress);
      setActivities(savedActivities);
      setTrainingDays(days);
      setPlayerNames(names ?? chessComName ?? "");
      if (profile === "calm" || profile === "tactical" || profile === "playful") {
        setCoachProfile(profile);
      }
    }).catch(() => {
      if (active) setStorageError(true);
    }).finally(() => {
      if (active) setLoading(false);
    });
    return () => { active = false; };
  }, [repository]);

  const aliases = useMemo(() => parsePlayerAliases(playerNames), [playerNames]);
  const puzzles = useMemo(() => buildTrainingPuzzles(games, caches), [caches, games]);
  const revenge = useMemo(
    () => orderRevengePuzzles(puzzles, progress, new Date()),
    [progress, puzzles],
  );
  const currentPuzzle = revenge.find((puzzle) => puzzle.key === activePuzzleKey)
    ?? revenge[0]
    ?? null;
  const questProgress = useMemo(() => buildQuestProgress(activities), [activities]);
  const trends = useMemo(
    () => buildPlayerTrends(games, caches, aliases),
    [aliases, caches, games],
  );
  const openings = useMemo(
    () => buildOpeningRepertoire(games, caches, aliases),
    [aliases, caches, games],
  );
  const visibleOpenings = openings.filter(
    (opening) => openingFilter === "all" || opening.color === openingFilter,
  );

  async function savePreferences() {
    const normalizedNames = parsePlayerAliases(playerNames).join(", ");
    try {
      await Promise.all([
        repository.setSetting(PLAYER_SETTING, normalizedNames),
        repository.setSetting(COACH_SETTING, coachProfile),
      ]);
      setPlayerNames(normalizedNames);
      setSaved(true);
      setStorageError(false);
      window.setTimeout(() => setSaved(false), 1800);
    } catch {
      setStorageError(true);
    }
  }

  async function recordPuzzle(result: PuzzleResult) {
    if (!currentPuzzle) return;
    const now = new Date();
    const previous = progress.find((item) => item.puzzleKey === currentPuzzle.key);
    const updated = updatePuzzleProgress(previous, currentPuzzle.key, result, now);
    try {
      await repository.savePuzzleProgress(updated);
      setProgress((items) => [...items.filter((item) => item.puzzleKey !== updated.puzzleKey), updated]);
      if (result !== "incorrect") {
        const activity = makeTrainingActivity("puzzle", currentPuzzle.key, now);
        await repository.recordTrainingActivity(activity);
        mergeActivity(activity);
      }
      setStorageError(false);
    } catch (error) {
      setStorageError(true);
      throw error;
    }
  }

  async function openRepertoireLine(opening: OpeningLine) {
    setSelectedOpening((current) => current === opening.key ? null : opening.key);
    const activity = makeTrainingActivity("opening", opening.key, new Date());
    try {
      await repository.recordTrainingActivity(activity);
      mergeActivity(activity);
      setStorageError(false);
    } catch {
      setStorageError(true);
    }
  }

  function mergeActivity(activity: TrainingActivity) {
    setActivities((items) => items.some((item) => (
      item.weekStart === activity.weekStart
      && item.kind === activity.kind
      && item.itemKey === activity.itemKey
    )) ? items : [...items, activity]);
    setTrainingDays((days) => days.includes(activity.occurredOn)
      ? days
      : [...days, activity.occurredOn]);
  }

  if (loading) {
    return <main className="loading-screen"><div className="loading-piece">♞</div><span>{t("trainingLab")}</span></main>;
  }

  return (
    <main className="training-page page-shell">
      <header className="training-header">
        <button className="text-button" onClick={onBack}>← {t("backToLibrary")}</button>
        <div>
          <p className="eyebrow">{t("trainingLocal")}</p>
          <h1>{t("trainingLab")}</h1>
          <p>{t("trainingTagline")}</p>
        </div>
        <div className="training-streak">
          <span aria-hidden="true">♨</span>
          <strong>{calculateTrainingStreak(trainingDays)}</strong>
          <small>{t("trainingDayStreak")}</small>
        </div>
      </header>

      <section className="training-preferences panel-card">
        <div>
          <p className="eyebrow">{t("trainingPersonalize")}</p>
          <h2>{t("trainingCoachProfile")}</h2>
        </div>
        <label>
          <span>{t("trainingPlayerNames")}</span>
          <input
            value={playerNames}
            onChange={(event) => setPlayerNames(event.target.value)}
            placeholder={t("trainingPlayerNamesPlaceholder")}
          />
        </label>
        <label>
          <span>{t("trainingCoachProfile")}</span>
          <select value={coachProfile} onChange={(event) => setCoachProfile(event.target.value as CoachProfileId)}>
            <option value="calm">{t("trainingCoachCalm")}</option>
            <option value="tactical">{t("trainingCoachTactical")}</option>
            <option value="playful">{t("trainingCoachPlayful")}</option>
          </select>
        </label>
        <button className="primary-button" onClick={() => void savePreferences()}>
          {saved ? t("trainingSaved") : t("trainingSave")}
        </button>
      </section>

      <WeeklyQuests progress={questProgress} t={t} />

      {storageError && <p className="training-storage-error" role="alert">{t("trainingStorageError")}</p>}

      {currentPuzzle ? (
        <TrainingPuzzle
          key={`${currentPuzzle.key}:${puzzleRound}`}
          puzzle={currentPuzzle}
          coachProfile={coachProfile}
          onRecord={recordPuzzle}
          onNext={() => {
            setActivePuzzleKey(revenge.find((puzzle) => puzzle.key !== currentPuzzle.key)?.key ?? currentPuzzle.key);
            setPuzzleRound((round) => round + 1);
          }}
          t={t}
        />
      ) : (
        <section className="training-empty panel-card">
          <span aria-hidden="true">♙</span>
          <div>
            <h2>{t("trainingNoPuzzles")}</h2>
            <p>{caches.length === 0 ? t("trainingAnalyzeFirst") : t("trainingNoMistakes")}</p>
          </div>
        </section>
      )}

      <section className="training-insights-grid">
        <TrendsPanel trends={trends} hasAliases={aliases.length > 0} t={t} />
        <RepertoirePanel
          openings={visibleOpenings}
          filter={openingFilter}
          selected={selectedOpening}
          hasAliases={aliases.length > 0}
          onFilter={setOpeningFilter}
          onOpen={openRepertoireLine}
          t={t}
        />
      </section>

      <p className="training-disclaimer">{t("trainingDisclaimer")}</p>
    </main>
  );
}

function WeeklyQuests({
  progress,
  t,
}: {
  progress: ReturnType<typeof buildQuestProgress>;
  t: TrainingScreenProps["t"];
}) {
  const label: Record<TrainingActivity["kind"], TranslationKey> = {
    review: "trainingQuestReview",
    puzzle: "trainingQuestPuzzle",
    opening: "trainingQuestOpening",
  };
  return (
    <section className="weekly-quests panel-card">
      <div>
        <p className="eyebrow">{t("trainingWeeklyQuests")}</p>
        <h2>{t("trainingNewMonday")}</h2>
      </div>
      <div className="quest-list">
        {progress.map((quest) => (
          <article className={quest.completed ? "complete" : ""} key={quest.kind}>
            <span aria-hidden="true">{quest.completed ? "✓" : "○"}</span>
            <div><strong>{t(label[quest.kind])}</strong><progress value={quest.progress} max={quest.target} /></div>
            <b>{Math.min(quest.progress, quest.target)}/{quest.target}</b>
          </article>
        ))}
      </div>
    </section>
  );
}

function TrendsPanel({
  trends,
  hasAliases,
  t,
}: {
  trends: ReturnType<typeof buildPlayerTrends>;
  hasAliases: boolean;
  t: TrainingScreenProps["t"];
}) {
  return (
    <section className="trends-panel panel-card">
      <p className="eyebrow">{t("trainingTrends")}</p>
      <h2>{t("trainingLastFive")}</h2>
      {!hasAliases ? <p>{t("trainingSetName")}</p> : trends.recent.games === 0 ? (
        <p>{t("trainingNoTrendData")}</p>
      ) : (
        <>
          <TrendMetrics window={trends.recent} t={t} />
          {trends.insufficientComparison ? (
            <small>{t("trainingSmallSample")}</small>
          ) : (
            <div className="previous-trend">
              <strong>{t("trainingPreviousFive")}</strong>
              <TrendMetrics window={trends.previous} t={t} compact />
            </div>
          )}
        </>
      )}
    </section>
  );
}

function TrendMetrics({
  window,
  compact = false,
  t,
}: {
  window: ReturnType<typeof buildPlayerTrends>["recent"];
  compact?: boolean;
  t: TrainingScreenProps["t"];
}) {
  const format = (value: number | null) => value === null ? "—" : value.toFixed(1);
  const percent = (value: number | null) => value === null ? "—" : `${value.toFixed(1)}%`;
  return (
    <div className={compact ? "trend-metrics compact" : "trend-metrics"}>
      <div><span>{t("games")}</span><strong>{window.games}</strong></div>
      <div><span>{t("trainingScore")}</span><strong>{percent(window.scorePercent)}</strong></div>
      <div><span>{t("chessMateAccuracy")}</span><strong>{format(window.accuracy)}</strong></div>
      <div><span>{t("trainingProblemRate")}</span><strong>{percent(window.problemRate)}</strong></div>
    </div>
  );
}

function RepertoirePanel({
  openings,
  filter,
  selected,
  hasAliases,
  onFilter,
  onOpen,
  t,
}: {
  openings: OpeningLine[];
  filter: "all" | PlayerSide;
  selected: string | null;
  hasAliases: boolean;
  onFilter: (filter: "all" | PlayerSide) => void;
  onOpen: (opening: OpeningLine) => Promise<void>;
  t: TrainingScreenProps["t"];
}) {
  return (
    <section className="repertoire-panel panel-card">
      <div className="repertoire-heading">
        <div><p className="eyebrow">{t("trainingRepertoire")}</p><h2>{t("trainingYourLines")}</h2></div>
        <div className="repertoire-filters">
          {(["all", "white", "black"] as const).map((value) => (
            <button className={filter === value ? "active" : ""} key={value} onClick={() => onFilter(value)}>
              {value === "all" ? t("trainingAll") : value === "white" ? t("white") : t("black")}
            </button>
          ))}
        </div>
      </div>
      {!hasAliases ? <p>{t("trainingSetName")}</p> : openings.length === 0 ? <p>{t("trainingNoOpenings")}</p> : (
        <div className="opening-list">
          {openings.map((opening) => (
            <button key={opening.key} onClick={() => void onOpen(opening)} className={selected === opening.key ? "open" : ""}>
              <strong>{opening.moves.join(" ")}</strong>
              <span>{opening.games} {t("games")} · {t("trainingWdl")} {opening.wins}-{opening.draws}-{opening.losses}</span>
              <b>{opening.scorePercent.toFixed(1)}%</b>
              {selected === opening.key && (
                <small>
                  {t("trainingOpeningDetails", {
                    accuracy: opening.accuracy?.toFixed(1) ?? "—",
                    problems: opening.problems,
                  })}
                </small>
              )}
            </button>
          ))}
        </div>
      )}
    </section>
  );
}
