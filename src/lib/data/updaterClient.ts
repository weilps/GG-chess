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

export async function checkForChessMateUpdate(): Promise<AvailableUpdate | null> {
  if (!isTauri()) throw new Error("desktopOnly");
  const update = await check({ timeout: 15_000 });
  return update ? wrapUpdate(update) : null;
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
      let downloaded = 0;
      let total: number | undefined;
      await update.downloadAndInstall((event: DownloadEvent) => {
        if (event.event === "Started") total = event.data.contentLength;
        if (event.event === "Progress") downloaded += event.data.chunkLength;
        onProgress(downloaded, total);
      }, { timeout: 120_000 });
    },
    close: () => update.close(),
  };
}
