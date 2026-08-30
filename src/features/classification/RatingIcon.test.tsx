import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { MoveClassificationId } from "../../types";
import { RatingIcon } from "./RatingIcon";

const classifications: MoveClassificationId[] = [
  "brilliant",
  "great",
  "best",
  "excellent",
  "good",
  "inaccuracy",
  "mistake",
  "miss",
  "blunder",
  "notRated",
];

describe("RatingIcon", () => {
  it("provides a distinct original SVG silhouette for every classification", () => {
    const { container } = render(<>
      {classifications.map((classification) => (
        <RatingIcon key={classification} classification={classification} label={classification} />
      ))}
    </>);
    const icons = [...container.querySelectorAll<SVGSVGElement>("[data-rating-icon]")];
    expect(icons).toHaveLength(classifications.length);
    expect(new Set(icons.map((icon) => icon.innerHTML)).size).toBe(classifications.length);
    expect(icons.map((icon) => icon.getAttribute("aria-label"))).toEqual(classifications);
  });
});
