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
npm run licenses:check
```

## Data, backup and updates

The About dialog can create a portable JSON backup, restore one transactionally, export the complete library as PGN, and check manually for updates. Backups include games, compatible Stockfish caches, Chess.com sync progress, Training Lab history and portable preferences; they exclude engine paths, secrets, Codex answers and consent. A malformed backup is rejected before the database is changed.

Update checks happen only after a click. Stable Windows releases are retrieved from this repository, verified with Tauri's committed updater public key, and installed only after confirmation. ChessMate performs no automatic update request in the background.

## Windows distribution

Development installers are per-user x64 NSIS bundles and are explicitly unsigned. Stable releases are produced only by the protected `release-windows` workflow: the tag, npm, Cargo and Tauri versions must match; all quality gates must pass; both the application and installer must carry a trusted, timestamped Authenticode signature; the updater installer must carry its separate Tauri signature; and an installer preservation smoke test must pass before the draft GitHub release is made public.

The workflow requires `WINDOWS_CERTIFICATE_PFX_BASE64`, `WINDOWS_CERTIFICATE_PASSWORD`, `TAURI_SIGNING_PRIVATE_KEY` and `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` repository secrets. The updater private key and password must also have an encrypted offline recovery copy outside Git. Losing that key prevents existing installations from trusting future updates; rotating it therefore requires an installer release signed through the existing update chain.

Release assets include the NSIS installer and updater signature, `latest.json`, SHA-256 checksums, SPDX SBOM, MIT license and generated third-party notices. ChessMate does not bundle Stockfish, Codex CLI, Chess.com content or En Croissant code.

## Scope

This release includes local analysis, ChessMate move ratings, an interactive Game Review, deterministic local coaching, an optional Codex adviser, public Chess.com archive import, and a local Training Lab for completed standard games. It intentionally contains no private-account access, variants, live play, cloud accounts or telemetry. Never use engine assistance during an active competitive game.

## Public Chess.com import

The Windows app can import completed public standard games from a Chess.com username without login, password, cookie or token. Requests are sent serially only to the official read-only Published Data API at `api.chess.com`; monthly `ETag` and `Last-Modified` validators are stored locally so completed months are skipped and the latest month is revalidated. Existing PGN fingerprints prevent duplicates, partial progress is preserved, and Chess.com accuracy or annotations are ignored.

Public data can be delayed or cached by its provider. ChessMate is an independent project, is not affiliated with Chess.com, and credits the official [Chess.com Published Data API](https://www.chess.com/news/view/published-data-api).

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

## Optional Codex adviser

The Windows app can turn the deterministic move facts into a personalized explanation by invoking the installed Codex CLI through a native, read-only Tauri bridge. Every request is manual and requires remembered first-use consent. Only the selected move's FENs, SAN, rating, mover-perspective values, best move, and saved principal variation are sent; player names, raw PGN, Chess.com identifiers, local paths, and secrets are excluded. Responses are never persisted.

This is an unofficial local workaround using the existing ChatGPT/Codex login and subscription quota, not an OpenAI API integration. It needs no separate API key or API billing, but it has no API SLA and remains subject to subscription availability and quota. ChessMate pins `gpt-5.6-terra` with `medium` reasoning, runs it ephemerally in an empty workspace with a read-only sandbox, permits one request at a time, and stops waiting after three minutes. The deterministic coach remains available when Codex is missing, logged out, busy, or unavailable.

## Training Lab

Training Lab turns Inaccuracy, Mistake, Miss and Blunder positions from saved Stockfish caches into local puzzles. Revenge mode accepts exactly the saved legal best move, supports promotions, and schedules the position for one, three or seven days according to Again, Good or Easy. Reveal uses only the saved best move and legal principal variation.

Calm Mentor, Tactical Drill and Playful Rival change deterministic encouragement only; they never change ratings, evaluations or lines. Weekly quests track distinct reviewed games, trained mistakes and opened repertoire lines from Monday to Monday. Trends compare up to five recent analyzed games with the previous five, while the opening repertoire groups the player's first four SAN plies with W-D-L, score, available ChessMate Accuracy and problem-move counts. Player aliases, puzzle history, quests and streak days remain in the local database; Training Lab makes no network or model request.

## Inspiration

ChessMate is a new independent project inspired in part by [En Croissant](https://github.com/franciscoBSalgueiro/en-croissant). No En Croissant code is included. En Croissant is licensed under GPL-3.0.

## Status

GUI-13 Windows distribution and portable-data slice, built through the Finn `spec → build → review` loop. A public stable installer remains intentionally blocked until the repository receives a trusted Authenticode certificate.
