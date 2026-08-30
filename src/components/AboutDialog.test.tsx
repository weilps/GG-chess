import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { translate } from "../i18n/translations";
import { MemoryGameRepository } from "../lib/db/gameRepository";
import { AboutDialog } from "./AboutDialog";

describe("AboutDialog", () => {
  it("keeps Codex privacy and operational facts out of the cockpit but available in About", () => {
    render(
      <AboutDialog
        games={[]}
        repository={new MemoryGameRepository()}
        language="en"
        onRestored={vi.fn()}
        onClose={vi.fn()}
        t={(key, variables) => translate("en", key, variables)}
      />,
    );

    const note = screen.getByRole("heading", { name: "Optional Codex adviser" }).closest("section");
    expect(note).toHaveTextContent("local Codex login");
    expect(note).toHaveTextContent("ChatGPT/Codex quota");
    expect(note).toHaveTextContent("no separate API key");
    expect(note).toHaveTextContent("not an official subscription API");
    expect(note).toHaveTextContent("local ChessMate database");
  });
});
