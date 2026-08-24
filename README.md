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

This release includes local analysis, ChessMate move ratings, an interactive Game Review, and deterministic local coaching for imported, completed games with an existing Windows UCI engine. It intentionally contains no AI coach, Chess.com integration, variants, live play, cloud accounts or telemetry. Never use engine assistance during an active competitive game.

## Local Stockfish analysis

ChessMate first checks the standard En Croissant Stockfish folder. If no valid engine is found, choose a local `.exe` from the review screen. The executable is validated with `uciok` and `readyok`; its path and the Quick (depth 12), Balanced (depth 18), or Deep (depth 22) profile are stored only in ChessMate's local database.

Stockfish is not downloaded or bundled by ChessMate. Games and positions never leave the computer during analysis.

## Move ratings and ChessMate Accuracy

For every move with both adjacent positions analyzed, ChessMate computes centipawn loss from the mover's point of view: `max(0, evaluation before − evaluation after)`. Mate scores use a bounded decisive value and displayed losses stop at `999+ cp`. Missing adjacent evaluations or invalid SAN are shown explicitly as **Not rated**.

Rules are applied in this order: **Brilliant** (best engine move, sound offer of material worth at least three points to a cheaper attacker, CPL ≤ 15), **Great** (best move finding mate or recovering from −1.50 to at least −0.50), **Best**, **Miss** (throws away a winning evaluation of at least +2.50 or mate), then **Excellent** (≤ 15 CPL), **Good** (≤ 50), **Inaccuracy** (≤ 100), **Mistake** (≤ 200), and **Blunder** (> 200).

**ChessMate Accuracy** is an independent local metric, not an official Chess.com score. Each rated move scores `100 × exp(−CPL / 120)`; each side's displayed accuracy is the average rounded to one decimal. Ratings always follow the currently selected engine, engine version, and analysis profile cache.

## Game Review

The interactive evaluation graph shows White's advantage from the starting position through the analyzed game. Centipawn evaluations are displayed in pawns and visually limited to ±10; mate scores use the corresponding winning bound. Missing cached positions break the line instead of inventing intermediate values. Every available point is keyboard-accessible and navigates the board, move list, evaluation bar, and selected-move detail together.

The vertical evaluation bar maps White's centipawn evaluation to `100 / (1 + exp(−cp / 400))`; mate is 100% or 0%, and an unavailable position is explicitly neutral. The summary counts every classification by player and lists at most five Inaccuracy, Mistake, Miss, or Blunder moments, sorted by centipawn loss then move order. All Game Review data is derived only from the active local engine/version/profile cache.

## Deterministic local coach

Select any move to see the classification reason, evaluation before and after from the mover's point of view, centipawn loss, Stockfish's saved best move, and up to six legal SAN plies from its principal variation. Missing or invalid saved lines are stated explicitly instead of being invented.

Tips use a transparent fixed priority: found or missed mate, checking best line, capturing best line, forcing-move safety for errors, candidate comparison for small losses, then process reinforcement. The same saved position always produces the same insight; this coach uses no model, network request, or official Chess.com explanation.

## Inspiration

ChessMate is a new independent project inspired in part by [En Croissant](https://github.com/franciscoBSalgueiro/en-croissant). No En Croissant code is included. En Croissant is licensed under GPL-3.0.

## Status

GUI-9 deterministic local coach slice, built through the Finn `spec → build → review` loop.
