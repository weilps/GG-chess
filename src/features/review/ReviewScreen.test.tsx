import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { translate } from "../../i18n/translations";
import { MemoryGameRepository } from "../../lib/db/gameRepository";
import type { StoredGame } from "../../types";
import { ReviewScreen } from "./ReviewScreen";
import { shouldPreserveReviewArrowKey } from "./reviewKeyboard";

vi.mock("react-chessboard", () => ({
  Chessboard: ({ options }: { options: { position: string } }) => (
    <div data-testid="chessboard-position">{options.position}</div>
  ),
}));

const game: StoredGame = {
  fingerprint: "review",
  white: "Ada",
  black: "Grace",
  result: "1-0",
  playedAt: null,
  displayDate: null,
  timeControl: null,
  source: null,
  rawPgn: "",
  moves: ["e4", "e5", "Nf3"],
  positions: ["start", "after-e4", "after-e5", "after-nf3"],
  importedAt: "2026-08-21T00:00:00Z",
};
const repository = new MemoryGameRepository();

describe("ReviewScreen", () => {
  beforeEach(() => vi.clearAllMocks());

  it("navigates with arrow keys and move buttons", () => {
    render(<ReviewScreen game={game} repository={repository} language="en" onBack={vi.fn()} t={(key, variables) => translate("en", key, variables)} />);
    expect(screen.getByTestId("chessboard-position")).toHaveTextContent("start");

    fireEvent.keyDown(window, { key: "ArrowRight" });
    expect(screen.getByTestId("chessboard-position")).toHaveTextContent("after-e4");
    fireEvent.click(screen.getByText("Nf3"));
    expect(screen.getByTestId("chessboard-position")).toHaveTextContent("after-nf3");
  });

  it("keeps navigation available after ordinary board and move controls receive focus", () => {
    render(<ReviewScreen game={game} repository={repository} language="en" onBack={vi.fn()} t={(key, variables) => translate("en", key, variables)} />);

    const flip = screen.getByRole("button", { name: "Flip board" });
    flip.focus();
    fireEvent.keyDown(flip, { key: "ArrowRight" });
    expect(screen.getByTestId("chessboard-position")).toHaveTextContent("after-e4");

    const move = screen.getByText("e4").closest("button");
    expect(move).not.toBeNull();
    move!.focus();
    fireEvent.keyDown(move!, { key: "ArrowRight" });
    expect(screen.getByTestId("chessboard-position")).toHaveTextContent("after-e5");
  });

  it("preserves arrows for native fields, editable content, composites, and active layers", () => {
    const host = document.createElement("div");
    const input = document.createElement("input");
    const select = document.createElement("select");
    const editable = document.createElement("div");
    const slider = document.createElement("div");
    const ordinaryButton = document.createElement("button");
    editable.setAttribute("contenteditable", "true");
    slider.setAttribute("role", "slider");
    host.append(input, select, editable, slider, ordinaryButton);
    document.body.append(host);

    expect(shouldPreserveReviewArrowKey(input)).toBe(true);
    expect(shouldPreserveReviewArrowKey(select)).toBe(true);
    expect(shouldPreserveReviewArrowKey(editable)).toBe(true);
    expect(shouldPreserveReviewArrowKey(slider)).toBe(true);
    expect(shouldPreserveReviewArrowKey(ordinaryButton)).toBe(false);

    const dialog = document.createElement("div");
    dialog.setAttribute("role", "dialog");
    host.append(dialog);
    expect(shouldPreserveReviewArrowKey(ordinaryButton)).toBe(true);
    dialog.remove();

    const popover = document.createElement("div");
    popover.setAttribute("popover", "auto");
    popover.style.display = "none";
    host.append(popover);
    expect(shouldPreserveReviewArrowKey(ordinaryButton)).toBe(false);

    popover.style.display = "block";
    expect(shouldPreserveReviewArrowKey(ordinaryButton)).toBe(true);
    host.remove();
  });

  it("flips the board", () => {
    render(<ReviewScreen game={game} repository={repository} language="en" onBack={vi.fn()} t={(key, variables) => translate("en", key, variables)} />);
    fireEvent.click(screen.getByRole("button", { name: "Flip board" }));
    expect(screen.getByTestId("board-orientation")).toHaveAttribute("data-orientation", "black");
  });

  it("distinguishes an unavailable Stockfish engine from an unrated move", async () => {
    render(<ReviewScreen game={game} repository={repository} language="en" onBack={vi.fn()} t={(key, variables) => translate("en", key, variables)} />);

    expect(screen.getAllByLabelText("Not rated")).toHaveLength(game.moves.length);
    fireEvent.click(screen.getByRole("tab", { name: "Summary" }));
    expect(screen.getAllByText("—", { selector: ".accuracy-sides strong" })).toHaveLength(2);
    fireEvent.click(screen.getByRole("tab", { name: "Moves" }));
    fireEvent.click(screen.getByText("e4"));
    const coach = screen.getByRole("region", { name: "Coach" });
    expect(await screen.findByText("Stockfish is unavailable. Open Analysis settings to choose an engine.")).toBeInTheDocument();
    expect(coach).not.toHaveTextContent("Not rated");
    expect(coach).not.toHaveTextContent("Analyze both adjacent positions to rate this move.");
  });

  it("does not offer engine analysis for a Result * game", () => {
    render(
      <ReviewScreen
        game={{ ...game, result: "*" }}
        repository={repository}
        language="en"
        onBack={vi.fn()}
        t={(key, variables) => translate("en", key, variables)}
      />,
    );
    expect(screen.getByText("Analysis is available only for completed games.")).toBeInTheDocument();
    expect(screen.getByText("Coach guidance is available only for completed games.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Analyze" })).not.toBeInTheDocument();
  });

  it("keeps moves as the default tab and supports keyboard tab navigation", () => {
    render(<ReviewScreen game={game} repository={repository} language="en" onBack={vi.fn()} t={(key, variables) => translate("en", key, variables)} />);

    const movesTab = screen.getByRole("tab", { name: "Moves" });
    expect(movesTab).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tabpanel", { name: "Moves" })).toBeInTheDocument();
    fireEvent.keyDown(movesTab, { key: "ArrowRight" });
    expect(screen.getByRole("tab", { name: "Summary" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tabpanel", { name: "Summary" })).toBeInTheDocument();
    expect(screen.getByTestId("chessboard-position")).toHaveTextContent("start");
  });

  it("keeps language and secondary destinations available in the review header", () => {
    const onLanguageChange = vi.fn();
    const onOpenTraining = vi.fn();
    const onOpenAbout = vi.fn();
    render(
      <ReviewScreen
        game={game}
        repository={repository}
        language="en"
        onLanguageChange={onLanguageChange}
        onBack={vi.fn()}
        onOpenTraining={onOpenTraining}
        onOpenAbout={onOpenAbout}
        t={(key, variables) => translate("en", key, variables)}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "FR" }));
    expect(onLanguageChange).toHaveBeenCalledWith("fr");
    const moreButton = screen.getByRole("button", { name: "More" });
    fireEvent.click(moreButton);
    const trainingItem = screen.getByRole("menuitem", { name: "Training Lab" });
    fireEvent.keyDown(trainingItem, { key: "ArrowRight" });
    expect(screen.getByTestId("chessboard-position")).toHaveTextContent("start");
    fireEvent.click(trainingItem);
    fireEvent.click(moreButton);
    fireEvent.click(screen.getByRole("menuitem", { name: "About" }));
    expect(onOpenTraining).toHaveBeenCalledOnce();
    expect(onOpenAbout).toHaveBeenCalledOnce();

    fireEvent.click(moreButton);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    expect(moreButton).toHaveFocus();
  });
});
