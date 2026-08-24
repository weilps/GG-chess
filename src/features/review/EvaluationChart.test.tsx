import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { translate } from "../../i18n/translations";
import type { MoveClassification, PositionEvaluation } from "../../types";
import { EvaluationChart } from "./EvaluationChart";

const evaluations: PositionEvaluation[] = [
  { positionIndex: 0, scoreCp: 0, mate: null, depth: 18, bestMove: "e2e4", pv: [] },
  { positionIndex: 1, scoreCp: 50, mate: null, depth: 18, bestMove: "e7e5", pv: [] },
];
const ratings: MoveClassification[] = [{
  moveIndex: 0,
  positionIndex: 1,
  color: "white",
  san: "e4",
  uci: "e2e4",
  classification: "best",
  reason: "engineBest",
  centipawnLoss: 0,
}];

describe("EvaluationChart", () => {
  it("navigates from accessible graph points with click and keyboard", () => {
    const onSelectPosition = vi.fn();
    render(
      <EvaluationChart
        evaluations={evaluations}
        ratings={ratings}
        moves={["e4", "e5"]}
        gameResult="1-0"
        selectedPositionIndex={0}
        onSelectPosition={onSelectPosition}
        t={(key, variables) => translate("en", key, variables)}
      />,
    );

    const movePoint = screen.getByRole("button", {
      name: "Position 1, after e4, evaluation +0.50",
    });
    fireEvent.click(movePoint);
    fireEvent.keyDown(movePoint, { key: "Enter" });
    expect(onSelectPosition).toHaveBeenNthCalledWith(1, 1);
    expect(onSelectPosition).toHaveBeenNthCalledWith(2, 1);
    expect(screen.getByRole("button", { name: /Starting position/ })).toHaveAttribute("aria-current", "true");
    expect(screen.getByText("Best")).toBeInTheDocument();
  });

  it("renders a localized empty state without inventing points", () => {
    render(
      <EvaluationChart
        evaluations={[]}
        ratings={[]}
        moves={["e4"]}
        gameResult="1-0"
        selectedPositionIndex={0}
        onSelectPosition={vi.fn()}
        t={(key, variables) => translate("fr", key, variables)}
      />,
    );
    expect(screen.getByText("Analysez des positions pour révéler le déroulement de la partie.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Position/ })).not.toBeInTheDocument();
  });
});
