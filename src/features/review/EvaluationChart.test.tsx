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
    expect(movePoint.tagName).toBe("BUTTON");
    expect(document.querySelector(".evaluation-chart")).toHaveAttribute("preserveAspectRatio", "none");
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

  it("keeps extreme compact chart targets inside the clipped card", () => {
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

    const firstHitTarget = screen.getByRole("button", { name: /Starting position/ });
    const lastHitTarget = screen.getByRole("button", { name: /Position 1/ });
    expect(firstHitTarget).toHaveAttribute("data-chart-x", "34");
    expect(firstHitTarget).toHaveAttribute("data-chart-y", "38");
    expect(lastHitTarget).toHaveAttribute("data-chart-x", "686");
    expect(lastHitTarget).toHaveAttribute("data-chart-y", "152");

    const chart = document.querySelector<SVGSVGElement>(".evaluation-chart");
    const [, , viewBoxWidth, viewBoxHeight] = chart?.getAttribute("viewBox")?.split(" ").map(Number) ?? [];
    const compactCardWidthAt360 = 344;
    const compactCardPadding = 10;
    const compactChartWidthAt360 = compactCardWidthAt360 - compactCardPadding * 2;
    const compactChartHeightAt720 = 111;
    const hitRadius = 22;
    const firstScreenX = compactCardPadding
      + Number(firstHitTarget.getAttribute("data-chart-x")) / viewBoxWidth * compactChartWidthAt360;
    const lastScreenX = compactCardPadding
      + (viewBoxWidth - Number(lastHitTarget.getAttribute("data-chart-x"))) / viewBoxWidth * compactChartWidthAt360;
    const firstScreenY = Number(firstHitTarget.getAttribute("data-chart-y")) / viewBoxHeight * compactChartHeightAt720;
    const lastScreenY = Number(lastHitTarget.getAttribute("data-chart-y")) / viewBoxHeight * compactChartHeightAt720;
    expect(firstScreenX).toBeGreaterThanOrEqual(hitRadius);
    expect(lastScreenX).toBeGreaterThanOrEqual(hitRadius);
    expect(firstScreenY).toBeGreaterThanOrEqual(hitRadius);
    expect(compactChartHeightAt720 - lastScreenY).toBeGreaterThanOrEqual(hitRadius);
    expect(chart).toHaveAttribute("preserveAspectRatio", "none");
  });
});
