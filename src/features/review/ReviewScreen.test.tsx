import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { translate } from "../../i18n/translations";
import { MemoryGameRepository } from "../../lib/db/gameRepository";
import type { StoredGame } from "../../types";
import { ReviewScreen } from "./ReviewScreen";

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

  it("flips the board", () => {
    render(<ReviewScreen game={game} repository={repository} language="en" onBack={vi.fn()} t={(key, variables) => translate("en", key, variables)} />);
    fireEvent.click(screen.getByRole("button", { name: "Flip board" }));
    expect(screen.getByTestId("board-orientation")).toHaveAttribute("data-orientation", "black");
  });

  it("keeps unrated moves explicit until adjacent evaluations are available", () => {
    render(<ReviewScreen game={game} repository={repository} language="en" onBack={vi.fn()} t={(key, variables) => translate("en", key, variables)} />);

    expect(screen.getAllByLabelText("Not rated")).toHaveLength(game.moves.length);
    fireEvent.click(screen.getByRole("tab", { name: "Summary" }));
    expect(screen.getAllByText("—", { selector: ".accuracy-sides strong" })).toHaveLength(2);
    fireEvent.click(screen.getByRole("tab", { name: "Moves" }));
    fireEvent.click(screen.getByText("e4"));
    expect(screen.getByTestId("selected-move-rating")).toHaveTextContent("Not rated");
    expect(screen.getByTestId("selected-move-rating")).toHaveTextContent("Analyze both adjacent positions to rate this move.");
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
    fireEvent.click(screen.getByRole("menuitem", { name: "Training Lab" }));
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
