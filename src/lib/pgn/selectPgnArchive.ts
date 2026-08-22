import { invoke, isTauri } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";

async function selectInBrowser(): Promise<string | null> {
  return new Promise((resolve, reject) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".pgn,application/x-chess-pgn,text/plain";
    input.addEventListener("change", async () => {
      const file = input.files?.[0];
      if (!file) {
        resolve(null);
        return;
      }
      try {
        resolve(await file.text());
      } catch (error) {
        reject(error);
      }
    });
    input.click();
  });
}

export async function selectPgnArchive(): Promise<string | null> {
  if (!isTauri()) {
    return selectInBrowser();
  }

  const selected = await open({
    multiple: false,
    directory: false,
    filters: [{ name: "Portable Game Notation", extensions: ["pgn"] }],
  });
  if (!selected || Array.isArray(selected)) {
    return null;
  }
  return invoke<string>("read_pgn_file", { path: selected });
}
