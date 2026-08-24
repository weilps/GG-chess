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
    render(<ReviewScreen game={game} repository={repository} onBack={vi.fn()} t={(key, variables) => translate("en", key, variables)} />);
    expect(screen.getByTestId("chessboard-position")).toHaveTextContent("start");

    fireEvent.keyDown(window, { key: "ArrowRight" });
    expect(screen.getByTestId("chessboard-position")).toHaveTextContent("after-e4");
    fireEvent.click(screen.getByText("Nf3"));
    expect(screen.getByTestId("chessboard-position")).toHaveTextContent("after-nf3");
  });

  it("flips the board", () => {
    render(<ReviewScreen game={game} repository={repository} onBack={vi.fn()} t={(key, variables) => translate("en", key, variables)} />);
    fireEvent.click(screen.getByText(/flip board/i));
    expect(screen.getByTestId("board-orientation")).toHaveAttribute("data-orientation", "black");
  });

  it("keeps unrated moves explicit until adjacent evaluations are available", () => {
    render(<ReviewScreen game={game} repository={repository} onBack={vi.fn()} t={(key, variables) => translate("en", key, variables)} />);

    expect(screen.getAllByLabelText("Not rated")).toHaveLength(game.moves.length);
    expect(screen.getAllByText("—", { selector: ".accuracy-sides strong" })).toHaveLength(2);
    fireEvent.click(screen.getByText("e4"));
    expect(screen.getByTestId("selected-move-rating")).toHaveTextContent("Not rated");
    expect(screen.getByTestId("selected-move-rating")).toHaveTextContent("Analyze both adjacent positions to rate this move.");
  });

  it("does not offer engine analysis for a Result * game", () => {
    render(
      <ReviewScreen
        game={{ ...game, result: "*" }}
        repository={repository}
        onBack={vi.fn()}
        t={(key, variables) => translate("en", key, variables)}
      />,
    );
    expect(screen.getByText("Analysis is available only for completed games.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Analyze" })).not.toBeInTheDocument();
  });
});
