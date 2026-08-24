import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { invoke } from "@tauri-apps/api/core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { translate } from "../../i18n/translations";
import { MemoryGameRepository } from "../../lib/db/gameRepository";
import { ChessComImportPanel } from "./ChessComImportPanel";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
  isTauri: () => true,
}));

const pgn = `[Event "Live Chess"]
[Site "https://www.chess.com/game/live/1"]
[Date "2026.08.24"]
[White "Ada"]
[Black "Grace"]
[Result "1-0"]

1. e4 e5 1-0`;

describe("ChessComImportPanel", () => {
  beforeEach(() => {
    vi.mocked(invoke).mockReset();
  });

  it("imports through the native bridge and displays the detailed summary", async () => {
    vi.mocked(invoke).mockImplementation(async (command) => {
      if (command === "chess_com_fetch_archives") {
        return { notModified: false, months: ["2026-08"], etag: "a", lastModified: null };
      }
      return {
        notModified: false,
        games: [{ pgn, rules: "chess" }],
        etag: "m",
        lastModified: null,
      };
    });
    const onGamesChanged = vi.fn().mockResolvedValue(undefined);
    render(
      <ChessComImportPanel
        repository={new MemoryGameRepository()}
        onGamesChanged={onGamesChanged}
        t={(key, variables) => translate("en", key, variables)}
      />,
    );

    await userEvent.type(screen.getByLabelText("Public username"), "Ada");
    await userEvent.click(screen.getByRole("button", { name: "Sync games" }));

    expect(await screen.findByText("Chess.com sync complete")).toBeInTheDocument();
    expect(screen.getByText("1 added")).toBeInTheDocument();
    expect(onGamesChanged).toHaveBeenCalledOnce();
    expect(vi.mocked(invoke).mock.calls.map(([command]) => command)).toEqual([
      "chess_com_fetch_archives",
      "chess_com_fetch_month",
    ]);
  });

  it("shows actionable errors in French", async () => {
    vi.mocked(invoke).mockRejectedValue("chess_com_not_found");
    render(
      <ChessComImportPanel
        repository={new MemoryGameRepository()}
        onGamesChanged={vi.fn().mockResolvedValue(undefined)}
        t={(key, variables) => translate("fr", key, variables)}
      />,
    );

    await userEvent.type(screen.getByLabelText("Nom d’utilisateur public"), "personne");
    await userEvent.click(screen.getByRole("button", { name: "Synchroniser" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Cet utilisateur Chess.com public est introuvable",
    );
  });
});
