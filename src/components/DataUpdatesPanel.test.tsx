import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { translate } from "../i18n/translations";
import { MemoryGameRepository } from "../lib/db/gameRepository";

const mocks = vi.hoisted(() => ({
  backup: vi.fn(),
  restore: vi.fn(),
  exportPgn: vi.fn(),
  check: vi.fn(),
  restart: vi.fn(),
  install: vi.fn(),
  close: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => ({ isTauri: () => true }));
vi.mock("../lib/data/dataFileClient", () => ({
  currentAppVersion: async () => "0.1.0",
  savePortableBackup: mocks.backup,
  restorePortableBackup: mocks.restore,
  savePgnExport: mocks.exportPgn,
}));
vi.mock("../lib/data/updaterClient", async (importOriginal) => ({
  ...await importOriginal<typeof import("../lib/data/updaterClient")>(),
  checkForChessMateUpdate: mocks.check,
  restartChessMate: mocks.restart,
}));

import { DataUpdatesPanel } from "./DataUpdatesPanel";
import { UpdateError } from "../lib/data/updaterClient";

describe("DataUpdatesPanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.backup.mockResolvedValue({ canceled: false, games: 2 });
    mocks.restore.mockResolvedValue({
      canceled: false,
      added: 3,
      updated: 1,
      unchanged: 2,
      rejected: 0,
      language: "fr",
    });
    mocks.exportPgn.mockResolvedValue({ canceled: false, games: 2 });
    mocks.check.mockResolvedValue(null);
    vi.spyOn(window, "confirm").mockReturnValue(true);
  });

  function renderPanel(onRestored = vi.fn().mockResolvedValue(undefined)) {
    render(
      <DataUpdatesPanel
        games={[]}
        repository={new MemoryGameRepository()}
        language="en"
        onRestored={onRestored}
        t={(key, variables) => translate("en", key, variables)}
      />,
    );
    return onRestored;
  }

  it("never checks the network before an explicit click", async () => {
    renderPanel();
    expect(await screen.findByText("Version 0.1.0")).toBeInTheDocument();
    expect(mocks.check).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "Check for updates" }));
    expect(await screen.findByText("ChessMate is up to date.")).toBeInTheDocument();
    expect(mocks.check).toHaveBeenCalledTimes(1);
  });

  it("runs backup, merge restore and PGN export only from their buttons", async () => {
    const onRestored = renderPanel();
    expect(mocks.backup).not.toHaveBeenCalled();
    expect(mocks.restore).not.toHaveBeenCalled();
    expect(mocks.exportPgn).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole("button", { name: "Back up" }));
    expect(await screen.findByText("Backup saved with 2 games.")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Restore" }));
    expect(await screen.findByText(/Restore complete: 3 added/)).toBeInTheDocument();
    expect(onRestored).toHaveBeenCalledWith("fr");
    await userEvent.click(screen.getByRole("button", { name: "Export PGN" }));
    expect(await screen.findByText("Exported 2 games as PGN.")).toBeInTheDocument();
  });

  it("asks before installing a signed update and before restarting", async () => {
    mocks.check.mockResolvedValue({
      version: "0.2.0",
      notes: "Safer and sharper.",
      downloadAndInstall: mocks.install.mockImplementation(async (progress) => {
        progress(50, 100);
      }),
      close: mocks.close.mockResolvedValue(undefined),
    });
    renderPanel();
    await userEvent.click(screen.getByRole("button", { name: "Check for updates" }));
    expect(await screen.findByText("ChessMate 0.2.0 is available.")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Download and install" }));
    expect(await screen.findByText(/verified update is installed/i)).toBeInTheDocument();
    expect(mocks.install).toHaveBeenCalledTimes(1);
    await userEvent.click(screen.getByRole("button", { name: "Restart ChessMate" }));
    expect(mocks.restart).toHaveBeenCalledTimes(1);
    expect(window.confirm).toHaveBeenCalledTimes(2);
  });

  it("distinguishes an offline check without pretending an update ran", async () => {
    mocks.check.mockRejectedValue(new UpdateError("offline"));
    renderPanel();
    await userEvent.click(screen.getByRole("button", { name: "Check for updates" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/could not reach the update service/i);
    expect(mocks.install).not.toHaveBeenCalled();
    expect(mocks.restart).not.toHaveBeenCalled();
  });

  it("refuses invalid or missing updater signatures", async () => {
    mocks.check.mockResolvedValue({
      version: "0.2.0",
      notes: "Untrusted fixture.",
      downloadAndInstall: mocks.install.mockRejectedValue(new UpdateError("invalid")),
      close: mocks.close.mockResolvedValue(undefined),
    });
    renderPanel();
    await userEvent.click(screen.getByRole("button", { name: "Check for updates" }));
    await userEvent.click(await screen.findByRole("button", { name: "Download and install" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/metadata or signature is invalid/i);
    expect(screen.queryByRole("button", { name: "Restart ChessMate" })).not.toBeInTheDocument();
    expect(mocks.restart).not.toHaveBeenCalled();
  });
});
