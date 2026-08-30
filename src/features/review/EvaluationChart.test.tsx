import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { translate } from "../../i18n/translations";
import type { MoveClassification, PositionEvaluation } from "../../types";
import { EvaluationChart } from "./EvaluationChart";

const evaluations: PositionEvaluation[] = [
  { positionIndex: 0, scoreCp: 0, mate: null, depth: 18, bestMove: "e2e4", pv: [], variations: [{ rank: 1, scoreCp: 0, mate: null, depth: 18, bestMove: "e2e4", pv: [] }] },
  { positionIndex: 1, scoreCp: 50, mate: null, depth: 18, bestMove: "e7e5", pv: [], variations: [{ rank: 1, scoreCp: 50, mate: null, depth: 18, bestMove: "e7e5", pv: [] }] },
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
  it("navigates from accessible graph points with click and keyboard", async () => {
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
      name: "Position 1, after e4, evaluation +0.50, Best",
    });
    fireEvent.click(movePoint);
    fireEvent.keyDown(movePoint, { key: "Enter" });
    movePoint.focus();
    fireEvent.keyDown(movePoint, { key: "ArrowLeft" });
    expect(onSelectPosition).toHaveBeenNthCalledWith(1, 1);
    expect(onSelectPosition).toHaveBeenNthCalledWith(2, 1);
    expect(onSelectPosition).toHaveBeenNthCalledWith(3, 0);
    const startingPoint = screen.getByRole("button", { name: /Starting position/ });
    expect(startingPoint).toHaveAttribute("aria-current", "true");
    await waitFor(() => expect(startingPoint).toHaveFocus());
    expect(movePoint.querySelector(".evaluation-point-hit")).toHaveAttribute("stroke-width", "44");
    expect(movePoint.querySelector(".evaluation-point-hit")).toHaveAttribute("vector-effect", "non-scaling-stroke");
    expect(screen.getByText("Best")).toBeInTheDocument();
    expect(movePoint.querySelector(".chart-rating-glyph")).toBeInTheDocument();
    expect(document.querySelector(".chart-selection-line")).toBeInTheDocument();
    expect(document.querySelector(".chart-selection-ring")).toBeInTheDocument();
    expect(document.querySelector('.chart-legend-icon [data-rating-icon="best"]')).toBeInTheDocument();
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

  it("uses the full compact chart width for extreme evaluations", () => {
    render(
      <EvaluationChart
        compact
        evaluations={[
          { ...evaluations[0], scoreCp: 1000 },
          { ...evaluations[1], scoreCp: -1000 },
        ]}
        ratings={ratings}
        moves={["e4"]}
        gameResult="1-0"
        selectedPositionIndex={0}
        onSelectPosition={vi.fn()}
        t={(key, variables) => translate("en", key, variables)}
      />,
    );

    const firstHitTarget = screen.getByRole("button", { name: /Starting position/ })
      .querySelector(".evaluation-point-hit");
    const lastHitTarget = screen.getByRole("button", { name: /Position 1/ })
      .querySelector(".evaluation-point-hit");
    expect(firstHitTarget).toHaveAttribute("cx", "34");
    expect(firstHitTarget).toHaveAttribute("cy", "45");
    expect(lastHitTarget).toHaveAttribute("cx", "708");
    expect(lastHitTarget).toHaveAttribute("cy", "145");

    const chart = document.querySelector<SVGSVGElement>(".evaluation-chart");
    const viewBoxHeight = Number(chart?.getAttribute("viewBox")?.split(" ")[3]);
    const compactChartHeight = 96;
    const hitRadius = 22;
    const firstScreenY = Number(firstHitTarget?.getAttribute("cy")) / viewBoxHeight * compactChartHeight;
    const lastScreenY = Number(lastHitTarget?.getAttribute("cy")) / viewBoxHeight * compactChartHeight;
    expect(firstScreenY).toBeGreaterThanOrEqual(hitRadius);
    expect(compactChartHeight - lastScreenY).toBeGreaterThanOrEqual(hitRadius);
  });
});
