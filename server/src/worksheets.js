// Worksheets: a learner uploads a self-contained HTML page and the app
// shows it back to them exactly as uploaded - no parsing, no extraction
// into exercises, just private storage + display. See db.js's worksheets
// table comment for why the file lives outside any publicly-served path.

import crypto from 'node:crypto';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import { db, DB_PATH } from './db.js';

export const WORKSHEETS_DIR = path.join(path.dirname(DB_PATH), 'worksheets');

export async function saveWorksheet({ userId, title, html }) {
  await fs.mkdir(WORKSHEETS_DIR, { recursive: true });
  const id = crypto.randomUUID();
  const filePath = `${id}.html`;
  await fs.writeFile(path.join(WORKSHEETS_DIR, filePath), html, 'utf-8');
  db.prepare('INSERT INTO worksheets (id, user_id, title, file_path, created_at) VALUES (?, ?, ?, ?, ?)').run(
    id, userId, title, filePath, new Date().toISOString()
  );
  return id;
}

export function listWorksheets(userId) {
  return db
    .prepare('SELECT id, title, created_at FROM worksheets WHERE user_id = ? ORDER BY created_at DESC')
    .all(userId)
    .map((r) => ({ id: r.id, title: r.title, createdAt: r.created_at }));
}

export function getWorksheet(userId, id) {
  const row = db.prepare('SELECT * FROM worksheets WHERE id = ? AND user_id = ?').get(id, userId);
  if (!row) return null;
  return { id: row.id, userId: row.user_id, title: row.title, filePath: row.file_path, createdAt: row.created_at };
}

export async function deleteWorksheet(userId, id) {
  const row = getWorksheet(userId, id);
  if (!row) return false;
  db.prepare('DELETE FROM worksheets WHERE id = ? AND user_id = ?').run(id, userId);
  await fs.unlink(path.join(WORKSHEETS_DIR, row.filePath)).catch(() => {});
  return true;
}

// --- Freely-placed notes (right-click -> "Notiz" anywhere in a worksheet) -

function parseNoteRow(row) {
  return { id: row.id, blockIndex: row.block_index, charOffset: row.char_offset, text: row.text, createdAt: row.created_at };
}

export function listWorksheetNotes(userId, worksheetId) {
  return db
    .prepare('SELECT * FROM worksheet_notes WHERE user_id = ? AND worksheet_id = ? ORDER BY created_at ASC')
    .all(userId, worksheetId)
    .map(parseNoteRow);
}

export function createWorksheetNote({ userId, worksheetId, blockIndex, charOffset, text }) {
  const id = crypto.randomUUID();
  db.prepare(
    'INSERT INTO worksheet_notes (id, user_id, worksheet_id, block_index, char_offset, text, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).run(id, userId, worksheetId, blockIndex, charOffset, text || '', new Date().toISOString());
  return id;
}

export function updateWorksheetNoteText(userId, worksheetId, noteId, text) {
  const result = db
    .prepare('UPDATE worksheet_notes SET text = ? WHERE id = ? AND user_id = ? AND worksheet_id = ?')
    .run(text, noteId, userId, worksheetId);
  return result.changes > 0;
}

export function deleteWorksheetNote(userId, worksheetId, noteId) {
  const result = db
    .prepare('DELETE FROM worksheet_notes WHERE id = ? AND user_id = ? AND worksheet_id = ?')
    .run(noteId, userId, worksheetId);
  return result.changes > 0;
}
