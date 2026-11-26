#!/usr/bin/env node
// Walks client/src and server/src, extracts each .js file's leading
// description comment, its exports, and its LOCAL (relative-path) imports,
// and writes the result as CODEMAP.md at the repo root. See ../SKILL.md for
// why this exists and when to regenerate it.
//
// Deliberately regex-based, not a real parser - this only needs to be
// right often enough to save a read, never load-bearing for correctness
// (nothing downstream trusts its output beyond "where do I even look"),
// and a dependency-free script is one less thing to audit or keep in sync
// with the toolchain.

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..', '..', '..', '..');
const SCAN_DIRS = ['client/src', 'server/src'];
const SKIP_DIR_NAMES = new Set(['__tests__', 'node_modules', 'dist']);
const OUTPUT_PATH = path.join(REPO_ROOT, 'CODEMAP.md');

async function collectJsFiles(dir) {
  const results = [];
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return results;
  }
  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (SKIP_DIR_NAMES.has(entry.name)) continue;
      results.push(...(await collectJsFiles(full)));
    } else if (entry.isFile() && entry.name.endsWith('.js')) {
      results.push(full);
    }
  }
  return results;
}

// The leading comment block, if any - lines of `//` (or a `/* ... */`
// block) before the first import/code line - taken as the file's own
// one-line description. Many files here already open with exactly this
// (see any existing file's header), so this mostly just surfaces text
// that's already there rather than inventing anything.
function extractDescription(text) {
  const lines = text.split('\n');
  const commentLines = [];
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (line === '') {
      if (commentLines.length) break;
      continue;
    }
    if (line.startsWith('//')) {
      commentLines.push(line.replace(/^\/\/\s*/, ''));
      continue;
    }
    if (line.startsWith('/*')) {
      // Collapse a /* ... */ block onto one logical description, stripping
      // a leading '*' continuation on each line.
      const blockLines = [];
      for (const inner of lines.slice(lines.indexOf(rawLine))) {
        const trimmed = inner.trim().replace(/^\*\s?/, '').replace(/\*\/\s*$/, '');
        if (trimmed) blockLines.push(trimmed);
        if (inner.includes('*/')) break;
      }
      commentLines.push(...blockLines);
      break;
    }
    break; // first non-comment, non-blank line - the description is done
  }
  if (!commentLines.length) return null;
  const joined = commentLines.join(' ').replace(/\s+/g, ' ').trim();
  return joined.length > 220 ? `${joined.slice(0, 217)}...` : joined;
}

function extractExports(text) {
  const names = new Set();
  let hasDefault = false;

  for (const m of text.matchAll(/^export\s+(?:async\s+)?function\s*\*?\s+(\w+)/gm)) names.add(m[1]);
  for (const m of text.matchAll(/^export\s+class\s+(\w+)/gm)) names.add(m[1]);
  for (const m of text.matchAll(/^export\s+const\s+(\w+)/gm)) names.add(m[1]);
  for (const m of text.matchAll(/^export\s+let\s+(\w+)/gm)) names.add(m[1]);
  for (const m of text.matchAll(/^export\s+default\s+/gm)) hasDefault = true;
  // export { a, b as c, ... } - names after "as" (or the name itself when
  // there's no "as") are what callers actually import, so that's what's
  // listed here.
  for (const m of text.matchAll(/^export\s*\{([^}]+)\}/gm)) {
    for (const part of m[1].split(',')) {
      const piece = part.trim();
      if (!piece) continue;
      const asMatch = piece.match(/\bas\s+(\w+)/);
      names.add(asMatch ? asMatch[1] : piece.split(/\s+/)[0]);
    }
  }

  const list = [...names].sort();
  if (hasDefault) list.push('default');
  return list;
}

// Only relative-path imports ('./x.js', '../y.js') - these are the edges
// worth drawing between files in THIS codebase; a bare import ('express',
// '../api.js' from node_modules, etc.) tells you nothing about this
// project's own structure.
function extractLocalImports(text, fileDir) {
  const targets = new Set();
  for (const m of text.matchAll(/(?:^|\s)import\s+(?:[^'"]*?\s+from\s+)?['"](\.[^'"]+)['"]/gm)) {
    targets.add(m[1]);
  }
  for (const m of text.matchAll(/(?:^|\s)export\s+(?:\*|\{[^}]*\})\s+from\s+['"](\.[^'"]+)['"]/gm)) {
    targets.add(m[1]);
  }
  return [...targets]
    .map((rel) => path.relative(REPO_ROOT, path.join(fileDir, rel)).replace(/\\/g, '/'))
    .sort();
}

async function buildEntry(absPath) {
  const text = await fs.readFile(absPath, 'utf-8');
  const relPath = path.relative(REPO_ROOT, absPath).replace(/\\/g, '/');
  return {
    relPath,
    description: extractDescription(text),
    exports: extractExports(text),
    imports: extractLocalImports(text, path.dirname(absPath)),
  };
}

function renderMarkdown(entriesByTopDir) {
  const now = new Date().toISOString();
  const lines = [
    '# Codebase Map',
    '',
    `Auto-generated by \`.claude/skills/graphify\` - do not hand-edit. Regenerate with:`,
    '```',
    'node .claude/skills/graphify/scripts/generate_map.mjs',
    '```',
    `Generated: ${now}`,
    '',
    'Read this file before opening source files to understand the codebase\'s',
    'shape - it has every file\'s one-line purpose, exports, and local',
    'dependencies. Open the actual file only for what this map can\'t answer',
    '(the real implementation, exact logic, non-exported helpers).',
    '',
  ];

  for (const [topDir, entries] of entriesByTopDir) {
    lines.push(`## ${topDir}`, '');
    for (const entry of entries) {
      lines.push(`### ${entry.relPath}`);
      if (entry.description) lines.push(`> ${entry.description}`);
      if (entry.exports.length) lines.push(`- exports: ${entry.exports.join(', ')}`);
      if (entry.imports.length) lines.push(`- imports: ${entry.imports.join(', ')}`);
      lines.push('');
    }
  }

  return lines.join('\n');
}

async function main() {
  const entriesByTopDir = [];
  for (const topDir of SCAN_DIRS) {
    const absDir = path.join(REPO_ROOT, topDir);
    const files = (await collectJsFiles(absDir)).sort();
    const entries = [];
    for (const file of files) entries.push(await buildEntry(file));
    entriesByTopDir.push([topDir, entries]);
  }

  const markdown = renderMarkdown(entriesByTopDir);
  await fs.writeFile(OUTPUT_PATH, markdown, 'utf-8');

  const totalFiles = entriesByTopDir.reduce((sum, [, entries]) => sum + entries.length, 0);
  console.log(`Wrote ${OUTPUT_PATH} (${totalFiles} files, ${markdown.length} bytes).`);
}

main();
