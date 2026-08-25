import { isTauri } from "@tauri-apps/api/core";
import { relaunch } from "@tauri-apps/plugin-process";
import { check, type DownloadEvent, type Update } from "@tauri-apps/plugin-updater";

export interface AvailableUpdate {
  version: string;
  date?: string;
  notes?: string;
  downloadAndInstall(onProgress: (downloaded: number, total?: number) => void): Promise<void>;
  close(): Promise<void>;
}

export type UpdateErrorCode = "offline" | "invalid";

export class UpdateError extends Error {
  constructor(public readonly code: UpdateErrorCode) {
    super(code);
  }
}

export async function checkForChessMateUpdate(): Promise<AvailableUpdate | null> {
  if (!isTauri()) throw new Error("desktopOnly");
  try {
    const update = await check({ timeout: 15_000 });
    return update ? wrapUpdate(update) : null;
  } catch (error) {
    throw classifyUpdateError(error);
  }
}

export async function restartChessMate(): Promise<void> {
  if (!isTauri()) throw new Error("desktopOnly");
  await relaunch();
}

function wrapUpdate(update: Update): AvailableUpdate {
  return {
    version: update.version,
    date: update.date,
    notes: update.body,
    async downloadAndInstall(onProgress) {
      try {
        let downloaded = 0;
        let total: number | undefined;
        await update.downloadAndInstall((event: DownloadEvent) => {
          if (event.event === "Started") total = event.data.contentLength;
          if (event.event === "Progress") downloaded += event.data.chunkLength;
          onProgress(downloaded, total);
        }, { timeout: 120_000 });
      } catch (error) {
        // Tauri verifies the updater signature before installation. Treat every
        // non-network failure as invalid metadata/signature and fail closed.
        throw classifyUpdateError(error);
      }
    },
    close: () => update.close(),
  };
}

function classifyUpdateError(error: unknown): UpdateError {
  if (error instanceof UpdateError) return error;
  const message = typeof error === "string"
    ? error
    : error instanceof Error ? error.message : "";
  return /network|offline|timed?\s*out|dns|connect|fetch|request/i.test(message)
    ? new UpdateError("offline")
    : new UpdateError("invalid");
}
