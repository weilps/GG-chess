import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { translate } from "../../i18n/translations";
import type { MoveClassification } from "../../types";
import { GameReviewSummary } from "./GameReviewSummary";

const ratings: MoveClassification[] = [
  { moveIndex: 0, positionIndex: 1, color: "white", san: "e4", uci: "e2e4", classification: "blunder", reason: "centipawnLoss", centipawnLoss: 320 },
  { moveIndex: 1, positionIndex: 2, color: "black", san: "e5", uci: "e7e5", classification: "mistake", reason: "centipawnLoss", centipawnLoss: 140 },
  { moveIndex: 2, positionIndex: 3, color: "white", san: "Nf3", uci: null, classification: "notRated", reason: "missingEvaluation", centipawnLoss: null },
];

describe("GameReviewSummary", () => {
  it("shows per-side counts and navigable critical moments without duplicating accuracy", () => {
    const onSelectPosition = vi.fn();
    render(
      <GameReviewSummary
        ratings={ratings}
        onSelectPosition={onSelectPosition}
        t={(key, variables) => translate("en", key, variables)}
      />,
    );
    expect(screen.queryByText("ChessMate Accuracy")).not.toBeInTheDocument();
    expect(screen.getByTestId("classification-white-blunder")).toHaveTextContent("1");
    expect(screen.getByTestId("classification-white-blunder").querySelector('[data-rating-icon="blunder"]')).toBeInTheDocument();
    expect(screen.getByTestId("classification-black-mistake")).toHaveTextContent("1");
    expect(screen.getByTestId("not-rated-white")).toHaveTextContent("1 not rated");

    const moments = screen.getAllByRole("button");
    expect(moments[0]).toHaveAccessibleName("White, move 1 e4, Blunder, 320 cp");
    fireEvent.click(moments[0]);
    expect(onSelectPosition).toHaveBeenCalledWith(1);
  });

  it("shows the French critical-moment empty state", () => {
    render(
      <GameReviewSummary
        ratings={[]}
        onSelectPosition={vi.fn()}
        t={(key, variables) => translate("fr", key, variables)}
      />,
    );
    expect(screen.getByText("Aucun moment critique classé pour l’instant.")).toBeInTheDocument();
  });
});
