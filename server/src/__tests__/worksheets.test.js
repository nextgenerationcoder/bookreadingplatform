import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { promises as fs } from 'node:fs';

const TEST_DB_DIR = await fs.mkdtemp(path.join(os.tmpdir(), 'worksheets-test-'));
process.env.DB_PATH = path.join(TEST_DB_DIR, 'test.db');

const {
  saveWorksheet,
  listWorksheets,
  getWorksheet,
  deleteWorksheet,
  WORKSHEETS_DIR,
  listWorksheetNotes,
  createWorksheetNote,
  updateWorksheetNoteText,
  deleteWorksheetNote,
} = await import('../worksheets.js');
const { db } = await import('../db.js');

test.after(async () => {
  db.close();
  await fs.rm(TEST_DB_DIR, { recursive: true, force: true });
  await fs.rm(WORKSHEETS_DIR, { recursive: true, force: true }).catch(() => {});
});

test('saveWorksheet writes the file to disk and a row to the DB, exactly as given', async () => {
  const html = '<html><body>hello</body></html>';
  const id = await saveWorksheet({ userId: 'u1', title: 'My worksheet', html });

  const worksheet = getWorksheet('u1', id);
  assert.equal(worksheet.title, 'My worksheet');
  const onDisk = await fs.readFile(path.join(WORKSHEETS_DIR, worksheet.filePath), 'utf-8');
  assert.equal(onDisk, html);
});

test('listWorksheets only returns the given user\'s own worksheets, newest first', async () => {
  await saveWorksheet({ userId: 'u2', title: 'First', html: '<p>1</p>' });
  await new Promise((r) => setTimeout(r, 5));
  await saveWorksheet({ userId: 'u2', title: 'Second', html: '<p>2</p>' });
  await saveWorksheet({ userId: 'u3', title: 'Someone else\'s', html: '<p>x</p>' });

  const list = listWorksheets('u2');
  assert.equal(list.length, 2);
  assert.equal(list[0].title, 'Second'); // newest first
  assert.ok(!list.some((w) => w.title === "Someone else's"));
});

test('getWorksheet returns null for another account\'s worksheet (never leaks across accounts)', async () => {
  const id = await saveWorksheet({ userId: 'u4', title: 'Private', html: '<p>x</p>' });
  assert.equal(getWorksheet('u5', id), null);
  assert.ok(getWorksheet('u4', id));
});

test('deleteWorksheet removes both the DB row and the file, and is a no-op for another account', async () => {
  const id = await saveWorksheet({ userId: 'u6', title: 'ToDelete', html: '<p>x</p>' });
  const worksheet = getWorksheet('u6', id);
  const filePath = path.join(WORKSHEETS_DIR, worksheet.filePath);
  assert.ok(await fs.access(filePath).then(() => true).catch(() => false));

  const deniedForOtherUser = await deleteWorksheet('u7', id);
  assert.equal(deniedForOtherUser, false);
  assert.ok(getWorksheet('u6', id)); // still there

  const ok = await deleteWorksheet('u6', id);
  assert.equal(ok, true);
  assert.equal(getWorksheet('u6', id), null);
  assert.ok(await fs.access(filePath).then(() => true).catch(() => false) === false);
});

// --- Freely-placed notes -------------------------------------------------

test('createWorksheetNote + listWorksheetNotes round-trips blockIndex/charOffset/text', async () => {
  const worksheetId = await saveWorksheet({ userId: 'u8', title: 'Notes test', html: '<p>x</p>' });
  const id = createWorksheetNote({ userId: 'u8', worksheetId, blockIndex: 2, charOffset: 17, text: 'Meine Notiz' });

  const notes = listWorksheetNotes('u8', worksheetId);
  assert.equal(notes.length, 1);
  assert.equal(notes[0].id, id);
  assert.equal(notes[0].blockIndex, 2);
  assert.equal(notes[0].charOffset, 17);
  assert.equal(notes[0].text, 'Meine Notiz');
});

test('listWorksheetNotes only returns notes for the given user+worksheet, oldest first', async () => {
  const worksheetId = await saveWorksheet({ userId: 'u9', title: 'Notes test 2', html: '<p>x</p>' });
  const otherWorksheetId = await saveWorksheet({ userId: 'u9', title: 'Other', html: '<p>y</p>' });
  createWorksheetNote({ userId: 'u9', worksheetId, blockIndex: 0, charOffset: 0, text: 'First' });
  await new Promise((r) => setTimeout(r, 5));
  createWorksheetNote({ userId: 'u9', worksheetId, blockIndex: 1, charOffset: 5, text: 'Second' });
  createWorksheetNote({ userId: 'u9', worksheetId: otherWorksheetId, blockIndex: 0, charOffset: 0, text: 'Belongs elsewhere' });
  createWorksheetNote({ userId: 'u10', worksheetId, blockIndex: 0, charOffset: 0, text: "Someone else's" });

  const notes = listWorksheetNotes('u9', worksheetId);
  assert.equal(notes.length, 2);
  assert.deepEqual(notes.map((n) => n.text), ['First', 'Second']);
});

test('updateWorksheetNoteText overwrites the text, and is a no-op for another account or worksheet', async () => {
  const worksheetId = await saveWorksheet({ userId: 'u11', title: 'Notes test 3', html: '<p>x</p>' });
  const id = createWorksheetNote({ userId: 'u11', worksheetId, blockIndex: 0, charOffset: 0, text: 'Original' });

  assert.equal(updateWorksheetNoteText('u12', worksheetId, id, 'Hacked'), false);
  assert.equal(listWorksheetNotes('u11', worksheetId)[0].text, 'Original');

  assert.equal(updateWorksheetNoteText('u11', worksheetId, id, 'Updated'), true);
  assert.equal(listWorksheetNotes('u11', worksheetId)[0].text, 'Updated');
});

test('deleteWorksheetNote removes it, and is a no-op for another account', async () => {
  const worksheetId = await saveWorksheet({ userId: 'u13', title: 'Notes test 4', html: '<p>x</p>' });
  const id = createWorksheetNote({ userId: 'u13', worksheetId, blockIndex: 0, charOffset: 0, text: 'ToDelete' });

  assert.equal(deleteWorksheetNote('u14', worksheetId, id), false);
  assert.equal(listWorksheetNotes('u13', worksheetId).length, 1);

  assert.equal(deleteWorksheetNote('u13', worksheetId, id), true);
  assert.equal(listWorksheetNotes('u13', worksheetId).length, 0);
});

test('deleting a worksheet cascades to delete its notes', async () => {
  const worksheetId = await saveWorksheet({ userId: 'u15', title: 'Notes test 5', html: '<p>x</p>' });
  createWorksheetNote({ userId: 'u15', worksheetId, blockIndex: 0, charOffset: 0, text: 'Will be cascaded' });
  assert.equal(listWorksheetNotes('u15', worksheetId).length, 1);

  await deleteWorksheet('u15', worksheetId);
  assert.equal(listWorksheetNotes('u15', worksheetId).length, 0);
});
