import { getVersion } from "@tauri-apps/api/app";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { open, save } from "@tauri-apps/plugin-dialog";
import type { Language, StoredGame } from "../../types";
import type { GameRepository } from "../db/gameRepository";
import {
  buildPortableBackup,
  exportPgnArchive,
  parsePortableBackup,
  serializePortableBackup,
  type RestoreSummary,
} from "./portableData";

export interface BackupResult {
  canceled: boolean;
  games: number;
}

export interface RestoreResult extends RestoreSummary {
  canceled: boolean;
  language?: Language;
}

export interface PgnExportResult {
  canceled: boolean;
  games: number;
}

export async function currentAppVersion(): Promise<string> {
  return isTauri() ? getVersion() : "0.1.0";
}

export async function savePortableBackup(
  repository: GameRepository,
  language: Language,
): Promise<BackupResult> {
  requireDesktop();
  const backup = await buildPortableBackup(
    repository,
    language,
    await currentAppVersion(),
  );
  const path = await save({
    defaultPath: `ChessMate-backup-${backup.createdAt.slice(0, 10)}.json`,
    filters: [{ name: "ChessMate portable backup", extensions: ["json"] }],
  });
  if (!path) return { canceled: true, games: 0 };
  await invoke("write_backup_file", {
    path,
    contents: serializePortableBackup(backup),
  });
  return { canceled: false, games: backup.games.length };
}

export async function restorePortableBackup(
  repository: GameRepository,
): Promise<RestoreResult> {
  requireDesktop();
  const path = await open({
    multiple: false,
    directory: false,
    filters: [{ name: "ChessMate portable backup", extensions: ["json"] }],
  });
  if (!path || Array.isArray(path)) {
    return { canceled: true, added: 0, updated: 0, unchanged: 0, rejected: 0 };
  }
  const contents = await invoke<string>("read_backup_file", { path });
  const backup = parsePortableBackup(contents);
  const summary = await repository.restorePortableData(backup);
  return { ...summary, canceled: false, language: backup.language };
}

export async function savePgnExport(games: StoredGame[]): Promise<PgnExportResult> {
  requireDesktop();
  if (games.length === 0) return { canceled: false, games: 0 };
  const path = await save({
    defaultPath: `ChessMate-games-${new Date().toISOString().slice(0, 10)}.pgn`,
    filters: [{ name: "Portable Game Notation", extensions: ["pgn"] }],
  });
  if (!path) return { canceled: true, games: 0 };
  await invoke("write_pgn_export", { path, contents: exportPgnArchive(games) });
  return { canceled: false, games: games.length };
}

function requireDesktop(): void {
  if (!isTauri()) throw new Error("desktopOnly");
}
