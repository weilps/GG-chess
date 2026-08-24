import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { translate } from "../../i18n/translations";
import type { MoveClassification } from "../../types";
import { MoveRatingBadge, MoveRatingsSummary } from "./MoveRatings";

const brilliant: MoveClassification = {
  moveIndex: 0,
  positionIndex: 1,
  color: "white",
  san: "Qa4",
  uci: "d1a4",
  classification: "brilliant",
  reason: "brilliantSacrifice",
  centipawnLoss: 0,
};

describe("MoveRatings", () => {
  it("renders an accessible localized badge", () => {
    render(<MoveRatingBadge rating={brilliant} t={(key, variables) => translate("fr", key, variables)} />);
    expect(screen.getByLabelText("Brillant")).toHaveTextContent("!!");
  });

  it("shows per-side accuracy and the selected move explanation", () => {
    render(
      <MoveRatingsSummary
        accuracy={{ white: 98.4, black: 87 }}
        selected={brilliant}
        t={(key, variables) => translate("en", key, variables)}
      />,
    );
    expect(screen.getByText("98.4")).toBeInTheDocument();
    expect(screen.getByText("87.0")).toBeInTheDocument();
    expect(screen.getByTestId("selected-move-rating")).toHaveTextContent("Brilliant");
    expect(screen.getByTestId("selected-move-rating")).toHaveTextContent("0 cp");
    expect(screen.getByText("Independent local formula")).toBeInTheDocument();
  });
});
