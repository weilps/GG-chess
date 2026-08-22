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
npm run tauri build -- --debug --no-bundle
```

## Scope

This release intentionally contains no engine analysis, move ratings, coach, Chess.com integration, variants, live play, cloud accounts or telemetry. Those belong in later Finn-loop tickets. Never use future engine assistance during an active competitive game.

## Inspiration

ChessMate is a new independent project inspired in part by [En Croissant](https://github.com/franciscoBSalgueiro/en-croissant). No En Croissant code is included. En Croissant is licensed under GPL-3.0.

## Status

GUI-5 foundation slice, built through the Finn `spec → build → review` loop.
