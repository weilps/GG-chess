import { useState } from "react";
import { Chessboard } from "react-chessboard";
import type { TranslationKey } from "../../i18n/translations";
import type { PuzzleResult } from "../../lib/db/gameRepository";
import { formatCentipawnLoss } from "../classification/classifyMoves";
import { ratingLabel } from "../classification/ratingPresentation";
import {
  checkPuzzleMove,
  promotionChoices,
  type CoachProfileId,
  type PuzzleGrade,
  type TrainingPuzzle as TrainingPuzzleData,
} from "./trainingData";

interface TrainingPuzzleProps {
  puzzle: TrainingPuzzleData;
  coachProfile: CoachProfileId;
  onRecord: (result: PuzzleResult) => Promise<void>;
  onNext: () => void;
  t: (key: TranslationKey, variables?: Record<string, string | number>) => string;
}

type PuzzleStatus = "ready" | "illegal" | "incorrect" | "correct" | "revealed" | "error";

export function TrainingPuzzle({
  puzzle,
  coachProfile,
  onRecord,
  onNext,
  t,
}: TrainingPuzzleProps) {
  const [status, setStatus] = useState<PuzzleStatus>("ready");
  const [displayFen, setDisplayFen] = useState(puzzle.fen);
  const [pendingPromotion, setPendingPromotion] = useState<{
    source: string;
    target: string;
    choices: string[];
  } | null>(null);
  const [saving, setSaving] = useState(false);

  async function submitMove(source: string, target: string, promotion?: string) {
    const result = checkPuzzleMove(puzzle, source, target, promotion);
    setPendingPromotion(null);
    if (!result.legal) {
      setStatus("illegal");
      return;
    }
    if (!result.correct) {
      setSaving(true);
      try {
        await onRecord("incorrect");
        setStatus("incorrect");
      } catch {
        setStatus("error");
      } finally {
        setSaving(false);
      }
      return;
    }
    setDisplayFen(result.resultingFen ?? puzzle.fen);
    setStatus("correct");
  }

  function handleDrop(source: string, target: string | null): boolean {
    if (!target || saving || status === "correct" || status === "revealed") return false;
    const choices = promotionChoices(puzzle.fen, source, target);
    if (choices.length > 0) {
      setPendingPromotion({ source, target, choices });
      return false;
    }
    void submitMove(source, target);
    return false;
  }

  async function reveal() {
    setSaving(true);
    try {
      await onRecord("revealed");
      setStatus("revealed");
    } catch {
      setStatus("error");
    } finally {
      setSaving(false);
    }
  }

  async function grade(result: PuzzleGrade) {
    setSaving(true);
    try {
      await onRecord(result);
      onNext();
    } catch {
      setStatus("error");
    } finally {
      setSaving(false);
    }
  }

  const introKey: Record<CoachProfileId, TranslationKey> = {
    calm: "trainingIntroCalm",
    tactical: "trainingIntroTactical",
    playful: "trainingIntroPlayful",
  };
  const successKey: Record<CoachProfileId, TranslationKey> = {
    calm: "trainingSuccessCalm",
    tactical: "trainingSuccessTactical",
    playful: "trainingSuccessPlayful",
  };

  return (
    <section className="training-puzzle-card" aria-labelledby="revenge-title">
      <div className="training-puzzle-heading">
        <div>
          <p className="eyebrow">{t("trainingRevenge")}</p>
          <h2 id="revenge-title">{t("trainingPuzzleTitle")}</h2>
          <span>{t(introKey[coachProfile])}</span>
        </div>
        <div className={`training-severity rating-${puzzle.rating.classification}`}>
          <strong>{ratingLabel(puzzle.rating.classification, t)}</strong>
          <small>{formatCentipawnLoss(puzzle.rating.centipawnLoss)}</small>
        </div>
      </div>
      <div className="training-puzzle-body">
        <div className="training-board">
          <Chessboard
            options={{
              id: `training-${puzzle.key}`,
              position: displayFen,
              boardOrientation: puzzle.color,
              allowDragging: status !== "correct" && status !== "revealed" && !saving,
              allowDrawingArrows: false,
              showAnimations: true,
              animationDurationInMs: 160,
              onPieceDrop: ({ sourceSquare, targetSquare }) => handleDrop(sourceSquare, targetSquare),
              darkSquareStyle: { backgroundColor: "#4f725f" },
              lightSquareStyle: { backgroundColor: "#d8decf" },
              boardStyle: { borderRadius: "8px", overflow: "hidden" },
            }}
          />
        </div>
        <div className="training-puzzle-copy">
          <div className="training-puzzle-meta">
            <span>{puzzle.gameLabel}</span>
            <span>{t("trainingMoveNumber", { count: Math.floor(puzzle.moveIndex / 2) + 1 })}</span>
            <span>{puzzle.engineName} · {puzzle.profile}</span>
          </div>
          <p>{t("trainingPlayedInstead", { move: puzzle.playedMoveSan })}</p>
          {pendingPromotion && (
            <div className="promotion-picker" aria-label={t("trainingPromotion") }>
              <strong>{t("trainingPromotion")}</strong>
              {pendingPromotion.choices.map((choice) => (
                <button
                  key={choice}
                  className="secondary-button"
                  onClick={() => void submitMove(pendingPromotion.source, pendingPromotion.target, choice)}
                >
                  {choice.toUpperCase()}
                </button>
              ))}
            </div>
          )}
          {status === "illegal" && <p className="training-feedback bad">{t("trainingIllegal")}</p>}
          {status === "incorrect" && <p className="training-feedback bad">{t("trainingTryAgain")}</p>}
          {status === "error" && <p className="training-feedback bad">{t("trainingStorageError")}</p>}
          {status === "correct" && (
            <div className="training-answer good">
              <strong>{t(successKey[coachProfile])}</strong>
              <p>{t("trainingBestMoveFact", { move: puzzle.bestMoveSan })}</p>
              <GradeButtons onGrade={grade} disabled={saving} t={t} />
            </div>
          )}
          {status === "revealed" && (
            <div className="training-answer reveal">
              <strong>{t("trainingAnswer", { move: puzzle.bestMoveSan })}</strong>
              {puzzle.principalVariationSan.length > 0 ? (
                <code>{puzzle.principalVariationSan.join(" ")}</code>
              ) : <p>{t("trainingNoLine")}</p>}
              <button className="primary-button" onClick={onNext}>{t("trainingNext")}</button>
            </div>
          )}
          {status !== "correct" && status !== "revealed" && (
            <button className="text-button training-reveal" onClick={() => void reveal()} disabled={saving}>
              {t("trainingReveal")}
            </button>
          )}
        </div>
      </div>
    </section>
  );
}

function GradeButtons({
  onGrade,
  disabled,
  t,
}: {
  onGrade: (grade: PuzzleGrade) => Promise<void>;
  disabled: boolean;
  t: TrainingPuzzleProps["t"];
}) {
  return (
    <div className="training-grade-buttons">
      <button className="secondary-button" disabled={disabled} onClick={() => void onGrade("again")}>
        {t("trainingAgain")} <small>{t("trainingOneDay")}</small>
      </button>
      <button className="secondary-button" disabled={disabled} onClick={() => void onGrade("good")}>
        {t("trainingGood")} <small>{t("trainingThreeDays")}</small>
      </button>
      <button className="primary-button" disabled={disabled} onClick={() => void onGrade("easy")}>
        {t("trainingEasy")} <small>{t("trainingSevenDays")}</small>
      </button>
    </div>
  );
}
