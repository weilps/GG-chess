import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { useLanguage } from "./useLanguage";

describe("useLanguage", () => {
  beforeEach(() => window.localStorage.clear());

  it("defaults to English and remembers a French selection", () => {
    const first = renderHook(() => useLanguage());
    expect(first.result.current.language).toBe("en");

    act(() => first.result.current.setLanguage("fr"));
    expect(window.localStorage.getItem("chessmate.language")).toBe("fr");
    first.unmount();

    const second = renderHook(() => useLanguage());
    expect(second.result.current.language).toBe("fr");
  });
});
