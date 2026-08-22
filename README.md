# ChessMate

ChessMate is a private, local-first Windows chess library built with Tauri 2, React and TypeScript. This first slice imports multi-game standard PGN archives, stores valid games in SQLite and provides a keyboard-navigable review board in English and French.

## Run locally

Requirements: Node.js, Rust and the Microsoft C++ Build Tools.

```powershell
npm install
npm run tauri dev
```

The web-only development view is available with `npm run dev`; it uses temporary in-memory storage. The Windows app uses the native file picker and persists games in a local SQLite database.

## Quality checks

```powershell
npm run lint
npm run typecheck
npm test
npm run build
cargo test --manifest-path src-tauri/Cargo.toml
npm run tauri build -- --debug --no-bundle
```

## Scope

This release includes local analysis of imported, completed games with an existing Windows UCI engine. It intentionally contains no move ratings, coach, Chess.com integration, variants, live play, cloud accounts or telemetry. Never use engine assistance during an active competitive game.

## Local Stockfish analysis

ChessMate first checks the standard En Croissant Stockfish folder. If no valid engine is found, choose a local `.exe` from the review screen. The executable is validated with `uciok` and `readyok`; its path and the Quick (depth 12), Balanced (depth 18), or Deep (depth 22) profile are stored only in ChessMate's local database.

Stockfish is not downloaded or bundled by ChessMate. Games and positions never leave the computer during analysis.

## Inspiration

ChessMate is a new independent project inspired in part by [En Croissant](https://github.com/franciscoBSalgueiro/en-croissant). No En Croissant code is included. En Croissant is licensed under GPL-3.0.

## Status

GUI-6 local-analysis slice, built through the Finn `spec → build → review` loop.
