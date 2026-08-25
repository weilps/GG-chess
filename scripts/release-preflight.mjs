import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const tagArgument = process.argv.find((argument) => argument.startsWith("--tag="));
const tagIndex = process.argv.indexOf("--tag");
const tag = tagArgument?.slice("--tag=".length)
  ?? (tagIndex >= 0 ? process.argv[tagIndex + 1] : undefined)
  ?? process.env.RELEASE_TAG
  ?? process.env.GITHUB_REF_NAME;

if (!tag || !/^v\d+\.\d+\.\d+$/.test(tag)) {
  throw new Error("A stable release tag in the form vX.Y.Z is required");
}

const packageJson = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8"));
const tauri = JSON.parse(readFileSync(resolve(root, "src-tauri", "tauri.conf.json"), "utf8"));
const cargo = readFileSync(resolve(root, "src-tauri", "Cargo.toml"), "utf8");
const cargoVersion = cargo.match(/^version\s*=\s*"([^"]+)"/m)?.[1];
const expectedVersion = tag.slice(1);

for (const [source, version] of [
  ["package.json", packageJson.version],
  ["src-tauri/tauri.conf.json", tauri.version],
  ["src-tauri/Cargo.toml", cargoVersion],
]) {
  if (version !== expectedVersion) {
    throw new Error(`${source} version ${version ?? "missing"} does not match ${tag}`);
  }
}

if (!tauri.bundle?.active || !tauri.bundle?.targets?.includes("nsis")) {
  throw new Error("The stable Windows release must build an NSIS bundle");
}
if (tauri.bundle?.createUpdaterArtifacts !== true) {
  throw new Error("Tauri updater artifacts must be enabled");
}
if (tauri.bundle?.windows?.nsis?.installMode !== "currentUser") {
  throw new Error("The supported installer scope is currentUser");
}
const endpoint = tauri.plugins?.updater?.endpoints?.[0];
if (endpoint !== "https://github.com/weilps/GG-chess/releases/latest/download/latest.json") {
  throw new Error("The updater endpoint must use the public GitHub latest release manifest");
}
if (typeof tauri.plugins?.updater?.pubkey !== "string" || tauri.plugins.updater.pubkey.length < 80) {
  throw new Error("A non-placeholder updater public key must be committed");
}

console.log(`Release contract valid for ${tag}`);
