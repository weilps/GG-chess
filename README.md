# ChessMate

ChessMate is a private, local-first Windows chess library built with Tauri 2, React and TypeScript. It imports multi-game standard PGN archives, stores valid games in SQLite, analyzes completed games with a local UCI engine, and provides a keyboard-navigable review board in English and French.

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

This release includes local analysis and ChessMate move ratings for imported, completed games with an existing Windows UCI engine. It intentionally contains no coach, Chess.com integration, variants, live play, cloud accounts or telemetry. Never use engine assistance during an active competitive game.

## Local Stockfish analysis

ChessMate first checks the standard En Croissant Stockfish folder. If no valid engine is found, choose a local `.exe` from the review screen. The executable is validated with `uciok` and `readyok`; its path and the Quick (depth 12), Balanced (depth 18), or Deep (depth 22) profile are stored only in ChessMate's local database.

Stockfish is not downloaded or bundled by ChessMate. Games and positions never leave the computer during analysis.

## Move ratings and ChessMate Accuracy

For every move with both adjacent positions analyzed, ChessMate computes centipawn loss from the mover's point of view: `max(0, evaluation before − evaluation after)`. Mate scores use a bounded decisive value and displayed losses stop at `999+ cp`. Missing adjacent evaluations or invalid SAN are shown explicitly as **Not rated**.

Rules are applied in this order: **Brilliant** (best engine move, sound offer of material worth at least three points to a cheaper attacker, CPL ≤ 15), **Great** (best move finding mate or recovering from −1.50 to at least −0.50), **Best**, **Miss** (throws away a winning evaluation of at least +2.50 or mate), then **Excellent** (≤ 15 CPL), **Good** (≤ 50), **Inaccuracy** (≤ 100), **Mistake** (≤ 200), and **Blunder** (> 200).

**ChessMate Accuracy** is an independent local metric, not an official Chess.com score. Each rated move scores `100 × exp(−CPL / 120)`; each side's displayed accuracy is the average rounded to one decimal. Ratings always follow the currently selected engine, engine version, and analysis profile cache.

## Inspiration

ChessMate is a new independent project inspired in part by [En Croissant](https://github.com/franciscoBSalgueiro/en-croissant). No En Croissant code is included. En Croissant is licensed under GPL-3.0.

## Status

GUI-7 move-classification and ChessMate Accuracy slice, built through the Finn `spec → build → review` loop.
