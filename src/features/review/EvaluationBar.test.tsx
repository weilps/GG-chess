import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { translate } from "../../i18n/translations";
import type { PositionEvaluation } from "../../types";
import { EvaluationBar } from "./EvaluationBar";

const evaluation: PositionEvaluation = {
  positionIndex: 2,
  scoreCp: 400,
  mate: null,
  depth: 18,
  bestMove: "g1f3",
  pv: [],
};

describe("EvaluationBar", () => {
  it("exposes the selected evaluation and documented White share", () => {
    render(<EvaluationBar evaluation={evaluation} gameResult="1-0" t={(key, variables) => translate("en", key, variables)} />);
    const meter = screen.getByRole("meter", { name: "Evaluation bar: +4.00, White share 73%" });
    expect(meter).toHaveAttribute("aria-valuenow", "73");
    expect(screen.getByText("+4.00")).toBeInTheDocument();
  });

  it("renders an explicit neutral unavailable state", () => {
    render(<EvaluationBar evaluation={null} gameResult="1-0" t={(key, variables) => translate("fr", key, variables)} />);
    expect(screen.getByRole("meter", { name: "Barre d’évaluation indisponible pour cette position" }))
      .not.toHaveAttribute("aria-valuenow");
  });
});
