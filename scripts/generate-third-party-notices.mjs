import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const checkOnly = process.argv.includes("--check");
const root = resolve(import.meta.dirname, "..");
const outputPath = resolve(root, "THIRD_PARTY_NOTICES.md");

const lock = JSON.parse(readFileSync(resolve(root, "package-lock.json"), "utf8"));
const npmPackages = Object.entries(lock.packages ?? {})
  .filter(([path, item]) => path && item?.version)
  .map(([path, item]) => ({
    name: item.name ?? packageNameFromPath(path),
    version: item.version,
    license: normalizeLicense(item.license),
  }));

const cargoFromProfile = process.env.USERPROFILE
  ? resolve(process.env.USERPROFILE, ".cargo", "bin", "cargo.exe")
  : undefined;
const cargoExecutable = process.env.CARGO
  ?? (cargoFromProfile && existsSync(cargoFromProfile) ? cargoFromProfile : "cargo");
const cargo = spawnSync(cargoExecutable, [
  "metadata",
  "--format-version",
  "1",
  "--locked",
  "--manifest-path",
  resolve(root, "src-tauri", "Cargo.toml"),
], { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 });
if (cargo.status !== 0) {
  throw new Error(cargo.stderr || cargo.error?.message || "cargo metadata failed");
}
const metadata = JSON.parse(cargo.stdout);
const rustPackages = metadata.packages
  .filter((item) => item.name !== "chessmate")
  .map((item) => ({
    name: item.name,
    version: item.version,
    license: normalizeLicense(item.license),
  }));

const render = (items) => uniquePackages(items)
  .map((item) => `| ${escapeCell(item.name)} | ${escapeCell(item.version)} | ${escapeCell(item.license)} |`)
  .join("\n");

const contents = `# Third-party notices

Generated from \`package-lock.json\` and Cargo metadata. Run \`npm run licenses\` after dependency changes; CI verifies this file is current.

ChessMate is a new, independent MIT-licensed application inspired by [En Croissant](https://encroissant.org). No En Croissant code is included, and no affiliation or endorsement is claimed.

Stockfish is detected as a separate user-installed executable and is not bundled or redistributed by ChessMate. Codex CLI is likewise user-installed and not redistributed. ChessMate is independent of Chess.com and does not redistribute proprietary Chess.com training content.

License expressions below are package metadata, not a replacement for each dependency's complete license file.

## npm packages

| Package | Version | License |
| --- | --- | --- |
${render(npmPackages)}

## Rust crates

| Crate | Version | License |
| --- | --- | --- |
${render(rustPackages)}
`;

if (checkOnly) {
  const existing = readFileSync(outputPath, "utf8");
  if (existing.replaceAll("\r\n", "\n") !== contents.replaceAll("\r\n", "\n")) {
    throw new Error("THIRD_PARTY_NOTICES.md is stale; run npm run licenses");
  }
} else {
  writeFileSync(outputPath, contents, "utf8");
}

function packageNameFromPath(path) {
  const marker = "node_modules/";
  const index = path.lastIndexOf(marker);
  return index >= 0 ? path.slice(index + marker.length) : path;
}

function normalizeLicense(value) {
  if (Array.isArray(value)) return value.join(" OR ");
  return typeof value === "string" && value.trim() ? value.trim() : "UNKNOWN";
}

function uniquePackages(items) {
  const unique = new Map();
  for (const item of items) unique.set(`${item.name}\u0000${item.version}`, item);
  return [...unique.values()].sort((left, right) => (
    left.name.localeCompare(right.name) || left.version.localeCompare(right.version)
  ));
}

function escapeCell(value) {
  return String(value).replaceAll("|", "\\|");
}
