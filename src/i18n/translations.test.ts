import { describe, expect, it } from "vitest";
import { translations } from "./translations";

describe("translations", () => {
  it("keeps English and French translation keys in sync", () => {
    expect(Object.keys(translations.fr).sort()).toEqual(
      Object.keys(translations.en).sort(),
    );
  });
});
