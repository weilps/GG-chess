import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { translate } from "../../i18n/translations";
import type { MoveClassification } from "../../types";
import { CoachPanel } from "./CoachPanel";
import type { CoachInsight } from "./coachInsight";

const rated: MoveClassification = {
  moveIndex: 1,
  positionIndex: 2,
  color: "black",
  san: "e5",
  uci: "e7e5",
  classification: "inaccuracy",
  reason: "centipawnLoss",
  centipawnLoss: 100,
};

const insight: CoachInsight = {
  rating: rated,
  before: "-0.50",
  after: "-1.50",
  bestMoveSan: "c5",
  principalVariationSan: ["c5", "Nf3"],
  lineStatus: "available",
  tip: "compareCandidates",
};

describe("CoachPanel", () => {
  it("shows the factual rating, mover metrics, saved line, tip, and disclaimer", () => {
    render(<CoachPanel insight={insight} t={(key, variables) => translate("en", key, variables)} />);
    const panel = screen.getByRole("region", { name: "Local coach" });
    expect(panel).toHaveTextContent("Inaccuracy");
    expect(panel).toHaveTextContent("Played e5");
    expect(panel).toHaveTextContent("-0.50");
    expect(panel).toHaveTextContent("-1.50");
    expect(panel).toHaveTextContent("100 cp");
    expect(panel).toHaveTextContent("c5");
    expect(screen.getByLabelText("Stockfish principal variation")).toHaveTextContent("c5 Nf3");
    expect(panel).toHaveTextContent("Compare at least two candidate moves");
    expect(panel).toHaveTextContent("not AI-generated or an official Chess.com explanation");
  });

  it("localizes the explicit unrated state in French", () => {
    render(<CoachPanel
      insight={{
        ...insight,
        rating: { ...rated, classification: "notRated", reason: "missingEvaluation", centipawnLoss: null },
        before: null,
        after: null,
        bestMoveSan: null,
        principalVariationSan: [],
        lineStatus: "missing",
        tip: "analyzeAdjacent",
      }}
      t={(key, variables) => translate("fr", key, variables)}
    />);
    const panel = screen.getByRole("region", { name: "Entraîneur local" });
    expect(panel).toHaveTextContent("Non classé");
    expect(panel).toHaveTextContent("Analysez les deux positions adjacentes");
    expect(panel).toHaveTextContent("ni généré par IA");
  });

  it("distinguishes selection and unfinished-game states", () => {
    const { rerender } = render(
      <CoachPanel insight={null} t={(key, variables) => translate("en", key, variables)} />,
    );
    expect(screen.getByText("Select a move to see its coaching insight.")).toBeInTheDocument();
    rerender(
      <CoachPanel insight={null} unavailable t={(key, variables) => translate("en", key, variables)} />,
    );
    expect(screen.getByText("Coach guidance is available only for completed games.")).toBeInTheDocument();
  });
});
