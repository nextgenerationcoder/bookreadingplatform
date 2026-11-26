---
name: graphify
description: Maintains CODEMAP.md, a compact auto-generated map of every client/src and server/src file's purpose, exports, and local import edges. Use this whenever you need to understand this repo's structure, find which file defines or exports something, trace what imports what, or get oriented before a multi-file change - read CODEMAP.md first instead of grepping or opening files one by one to map out the codebase. Also use it any time you've just added, removed, renamed, or moved a file, or added/removed an export, so CODEMAP.md stays trustworthy for the next person (or the next session) who reads it first.
---

# graphify

A small dependency-free script (`scripts/generate_map.mjs`) that walks
`client/src` and `server/src`, and for every `.js` file extracts:

- its leading comment, as a one-line description
- its exported functions/classes/consts (`export function X`, `export const
  Y`, `export { a, b as c }`, `export default`, ...)
- its LOCAL (relative-path) imports - i.e. which other files in this repo it
  depends on

...and writes the result to `CODEMAP.md` at the repo root.

## Why this exists

Understanding "where does X live" or "what does this file depend on" by
grepping and opening files one at a time burns a lot of tokens on a repo
this size, and most of that reading is throwaway - you don't need a file's
full implementation to know it exists and roughly what it's for. CODEMAP.md
front-loads that: one file, read once, answers "which file has this" and
"what would break if I change that" for the whole client+server source tree.

## How to use it

**Before** opening several files to get oriented in this codebase (a bug
report with no file named, "where is X implemented", "what calls Y",
planning a change that might span files), read `CODEMAP.md` first. It tells
you which file to actually open - open that one, not everything that looked
plausible.

It is not a substitute for reading the real file once you know which one
you need: CODEMAP.md only has a one-line description and a list of names,
never real logic, non-exported helpers, or anything server/client page
templates render inline. Treat it as an index, not a reference.

**After** a change that adds, removes, or renames a file, or adds/removes/
renames an export, regenerate it so the map doesn't go stale:

```bash
node .claude/skills/graphify/scripts/generate_map.mjs
```

This overwrites `CODEMAP.md` in place (it's regenerated wholesale each
time, not patched) - commit it alongside the code change, the same way
you'd commit any other file the change touched. A change that only edits a
function's body, with no export/import/file-list change, never needs this.

## Scope

Only `client/src` and `server/src` (excluding `__tests__` directories) -
this app's own two source trees. It doesn't cover `server/content`,
`server/content-courses`, `server/data`, `server/scripts`,
`tools/`, or anything outside those two folders, config files, or the
seed/migration data those folders hold.
