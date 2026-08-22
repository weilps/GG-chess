import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { translate } from "../../i18n/translations";
import type { StoredGame } from "../../types";
import { LibraryScreen } from "./LibraryScreen";

const game: StoredGame = {
  fingerprint: "one",
  white: "Ada",
  black: "Grace",
  result: "1-0",
  playedAt: "2026-08-20T10:00:00Z",
  displayDate: "2026-08-20",
  timeControl: "600+5",
  source: "Local club",
  rawPgn: "",
  moves: ["e4"],
  positions: ["start", "after"],
  importedAt: "2026-08-21T00:00:00Z",
};

describe("LibraryScreen", () => {
  it("opens a game on double click", () => {
    const onOpenGame = vi.fn();
    render(
      <LibraryScreen
        games={[game]}
        isImporting={false}
        onImport={vi.fn()}
        onOpenGame={onOpenGame}
        t={(key, variables) => translate("en", key, variables)}
      />,
    );

    fireEvent.doubleClick(screen.getByText("Ada").closest("[role='row']")!);
    expect(onOpenGame).toHaveBeenCalledWith(game);
  });
});
