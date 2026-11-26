# Office Roleplay Game — Design

A single-player, text-based roleplay game for German learners, inspired by D&D.
The player is a new employee at a fictional German company. Each turn the AI
writes a short scene in German and offers exactly two choices; the player
picks one and the story continues.

Fun comes first (~70%), language learning second (~30%).

## Setting

New employee at **"Brandt & Partner GmbH"**. No end goal — the game ends only
when you get fired.

## Fixed NPCs

- **Frau Krüger** — boss, strict but fair.
- **Jonas** — friendly colleague, loves gossip.
- **Lena** — colleague, possible flirt/romance (flirting only, no explicit
  content).
- **Herr Becker** — ambitious rival.

## Core principle

**CODE owns all numbers and state, the AI owns narration.** The AI never
invents numbers. Every stat (XP, boss opinion, relationship levels, etc.) is
read and written by server-side code; the AI only ever receives the current
state as context and returns narration/choices, never a number.

## Planned mechanics (later tasks)

- XP for cheeky/mischievous actions.
- Boss opinion (0–100, visible to the player, updated immediately);
  reaching 0 = fired = game over.
- Relationships with NPCs.
- Vocabulary from the user's word list woven into scenes.
- Language exercises as D&D-style "skill checks".
- Clickable words (reusing `clickableGermanText.js`, as used elsewhere in
  the app).
- Notes with AI (reusing the worksheets' free-note + "/ai" pattern).

## Step 2 scope (current)

Minimal playable loop only: start a game, see a scene with two choices, pick
one, see the next scene follow from that choice, and have the game resume on
refresh. No XP, no boss meter, no vocabulary weaving, no exercises yet — those
are later tasks layered on top of this loop once it's solid.

## Content rules (AI narration)

- German at B1 level.
- Scene length: short (2–4 sentences, ~40–70 words) and mostly dialogue, not
  descriptive narration — a little longer (~90 words) is fine only when
  needed to naturally fit in a target vocabulary word.
- Office setting with varied situations (meetings, kitchen, emails, phone
  calls, after work).
- Stay in character for the fixed NPCs above.
- The two choices should clearly differ — usually one professional/safe and
  one cheeky/risky.
- Romance (with Lena) limited to flirting only.

## Architecture (Step 2)

- Reuses the app's existing session auth (`requireAuth`) — no separate login
  for the game.
- Reuses the app's existing per-account AI key infrastructure
  (`llm.js` + `crypto.js`'s encrypted `llm_provider`/`llm_api_key_enc` on
  `users`) rather than a new server-side API key — same "bring your own key"
  convention as every other AI feature in this app (worksheets' `/ai`
  command, Practice course generation, Extract pattern, etc.).
- `server/src/game/prompt.js` — builds the system prompt (setting,
  characters, tone, content rules) and the per-turn prompt (story summary so
  far + the player's last choice).
- `server/src/game/ai.js` — looks up the account's AI key and calls
  `llm.js`'s `generateGameTurn`, the same per-provider forced-JSON-output
  pattern as every other AI call in this app.
- `game_sessions` / `game_turns` tables (`db.js`) — current state and full
  turn history.
- Routes behind the existing auth: `POST /api/game/start`,
  `GET /api/game/current`, `POST /api/game/choose`.
- The current scene and choices are stored **server-side** (`pending_json`)
  — the client only ever sends the choice index, never scene content.
