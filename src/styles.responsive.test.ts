import { describe, expect, it } from "vitest";
import styles from "./styles.css?raw";

describe("responsive review styles", () => {
  it("keeps the open analysis settings inside narrow viewports", () => {
    const mobileStart = styles.indexOf("@media (max-width: 560px)");
    const reducedMotionStart = styles.indexOf("@media (prefers-reduced-motion", mobileStart);
    const mobileStyles = styles.slice(mobileStart, reducedMotionStart);

    expect(mobileStart).toBeGreaterThanOrEqual(0);
    expect(mobileStyles).toContain(".review-header { padding: 6px 10px; backdrop-filter: none; }");
    expect(mobileStyles).toContain(
      ".engine-settings-popover { position: fixed; inset: 12px; width: auto; max-height: none; }",
    );
  });

  it("keeps every settings select at the minimum pointer target height", () => {
    expect(styles).toMatch(/\.engine-profile-row select \{[^}]*min-height: 44px;/);
    expect(styles).toMatch(/\.guidance-mode-control select \{[^}]*min-height: 44px;/);
  });
});
