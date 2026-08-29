import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import App from "./App";

const { pgn } = vi.hoisted(() => ({ pgn: `[Event "Training"]
[Site "Local"]
[Date "2026.08.25"]
[White "Ada"]
[Black "Grace"]
[Result "1-0"]

1. e4 e5 2. Nf3 Nc6 1-0` }));

vi.mock("./lib/pgn/selectPgnArchive", () => ({
  selectPgnArchive: vi.fn().mockResolvedValue(pgn),
}));

describe("App Training Lab navigation", () => {
  it("records a distinct review toward the weekly quest", async () => {
    render(<App />);
    const importButtons = await screen.findAllByRole("button", { name: "Import PGN" });
    await userEvent.click(importButtons[0]);
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Close" }));

    await userEvent.click(screen.getByRole("button", { name: "Open game: Ada – Grace" }));
    expect(await screen.findByText("Game Review")).toBeInTheDocument();
    await userEvent.click(screen.getByLabelText("More"));
    await userEvent.click(screen.getByRole("menuitem", { name: "Training Lab" }));

    const reviewQuest = (await screen.findByText("Review 3 different games")).closest("article")!;
    expect(within(reviewQuest).getByText("1/3")).toBeInTheDocument();
  }, 20_000);
});
