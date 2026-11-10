import { api } from '../api.js';

// Private interactive-textbook import (Step 1): upload a lesson's textbook
// PDF + transcript PDF + MP3s, watch the import job run, then review/correct
// whatever the extraction flagged as uncertain. No student-facing player
// here on purpose - this view is the import + review tool only.

export async function renderAddTextbook(host) {
  host.innerHTML = `
    <div class="formPage">
      <a href="#/">← Library</a>
      <h1>Import textbook lesson</h1>
      <p class="hint">
        Upload one lesson's textbook PDF (the actual printed pages), its transcript PDF (optional) and
        its MP3s (optional, multiple files). The textbook PDF is read with your account's Vision API key
        (Settings) - without one configured, exercises are extracted but every uncertain field is left for
        you to fill in below.
      </p>

      <form id="tbForm">
        <label>Book ID (reused across lessons of the same book)<br>
          <input type="text" id="tbBookId" placeholder="starten-wir-b1" required></label><br><br>
        <label>Book title<br>
          <input type="text" id="tbBookTitle" placeholder="Starten wir! B1" required></label><br><br>
        <label>Lesson number<br>
          <input type="number" id="tbLessonNumber" min="1" required></label><br><br>
        <label>Lesson title<br>
          <input type="text" id="tbLessonTitle" placeholder="Paare, Serien &amp; mehr" required></label><br><br>
        <label>Printed page number of the textbook PDF's first page<br>
          <input type="number" id="tbPrintedPageStart" min="1"></label><br><br>

        <label>Textbook PDF (required)<br>
          <input type="file" id="tbTextbookPdf" accept="application/pdf" required></label><br><br>
        <label>Transcript PDF (optional)<br>
          <input type="file" id="tbTranscriptPdf" accept="application/pdf"></label><br><br>
        <label>Audio files (optional, multiple)<br>
          <input type="file" id="tbAudio" accept="audio/*" multiple></label><br><br>

        <button type="submit" id="tbSubmit">Start import</button>
      </form>

      <div id="tbStatus"></div>
      <div id="tbReview"></div>
    </div>
  `;

  const form = host.querySelector('#tbForm');
  const statusEl = host.querySelector('#tbStatus');
  const reviewEl = host.querySelector('#tbReview');
  let pollHandle = null;

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    host.querySelector('#tbSubmit').disabled = true;
    statusEl.innerHTML = '<p>Uploading…</p>';

    const bookId = host.querySelector('#tbBookId').value.trim();
    const lessonNumber = Number(host.querySelector('#tbLessonNumber').value);

    try {
      const { jobId } = await api.importTextbookLesson({
        textbookPdf: host.querySelector('#tbTextbookPdf').files[0],
        transcriptPdf: host.querySelector('#tbTranscriptPdf').files[0] || null,
        audioFiles: Array.from(host.querySelector('#tbAudio').files || []),
        bookId,
        bookTitle: host.querySelector('#tbBookTitle').value.trim(),
        lessonNumber,
        lessonTitle: host.querySelector('#tbLessonTitle').value.trim(),
        printedPageStart: host.querySelector('#tbPrintedPageStart').value || null,
      });
      pollHandle = setInterval(() => pollStatus(jobId, bookId, lessonNumber), 1500);
      await pollStatus(jobId, bookId, lessonNumber);
    } catch (err) {
      statusEl.innerHTML = `<div class="error">${escapeHtml(err.message)}</div>`;
      host.querySelector('#tbSubmit').disabled = false;
    }
  });

  async function pollStatus(jobId, bookId, lessonNumber) {
    let job;
    try {
      job = await api.getTextbookImportStatus(jobId);
    } catch (err) {
      statusEl.innerHTML = `<div class="error">${escapeHtml(err.message)}</div>`;
      clearInterval(pollHandle);
      return;
    }

    statusEl.innerHTML = `
      <p>Status: <strong>${escapeHtml(job.status)}</strong> (${escapeHtml(job.stage || '')})
        — page ${job.currentPage || 0}${job.totalPages ? ` / ${job.totalPages}` : ''},
        ${job.exercisesFound} exercise(s) found</p>
      ${job.errors?.length ? `<ul class="error">${job.errors.map((e) => `<li>${escapeHtml(e.error)}${e.printedPage ? ` (page ${e.printedPage})` : ''}</li>`).join('')}</ul>` : ''}
    `;

    if (job.status === 'completed' || job.status === 'failed') {
      clearInterval(pollHandle);
      host.querySelector('#tbSubmit').disabled = false;
      if (job.status === 'completed') await renderReview(bookId, lessonNumber);
    }
  }

  async function renderReview(bookId, lessonNumber) {
    const { exercises } = await api.listTextbookExercises(bookId, lessonNumber);
    if (!exercises.length) {
      reviewEl.innerHTML = '<p>No exercises were found.</p>';
      return;
    }

    reviewEl.innerHTML = `
      <h2>Exercises (${exercises.length})</h2>
      ${exercises.map((ex) => exerciseCardHtml(ex)).join('')}
    `;

    for (const ex of exercises) {
      const card = reviewEl.querySelector(`[data-exercise-id="${ex.id}"]`);
      card.querySelector('.tbSaveBtn').addEventListener('click', async () => {
        const instructions = card.querySelector('.tbInstructions').value;
        let content;
        try {
          content = JSON.parse(card.querySelector('.tbContent').value);
        } catch {
          card.querySelector('.tbSaveError').textContent = 'Content is not valid JSON.';
          return;
        }
        const verified = card.querySelector('.tbVerified').checked;
        await api.updateTextbookExercise(ex.id, { instructions, content, answerKeyVerified: verified, needsReview: !verified });
        card.querySelector('.tbSaveError').textContent = 'Saved.';
      });
    }
  }

  function exerciseCardHtml(ex) {
    return `
      <div class="tbCard" data-exercise-id="${ex.id}" style="border:1px solid #ccc; margin:12px 0; padding:12px;">
        <strong>${escapeHtml(ex.exerciseNumber)}${ex.subNumber ? `.${escapeHtml(ex.subNumber)}` : ''}</strong>
        — ${escapeHtml(ex.exerciseType)}
        ${ex.printedPage ? ` (page ${ex.printedPage})` : ''}
        ${ex.needsReview ? ' <span style="color:#b00">needs review</span>' : ' <span style="color:#080">reviewed</span>'}
        ${ex.extractionConfidence != null ? ` — confidence ${Math.round(ex.extractionConfidence * 100)}%` : ''}
        (${escapeHtml(ex.extractionSource)})
        <br>
        ${ex.images.map((img) => `<img src="${api.textbookMediaUrl(img.id)}" alt="${escapeHtml(img.caption || '')}" style="max-width:200px; display:block; margin:6px 0;">`).join('')}
        ${ex.audio.map((a) => `<audio controls src="${api.textbookMediaUrl(a.id)}"></audio>`).join('')}
        ${ex.transcripts.map((t) => `<details><summary>Transcript: ${escapeHtml(t.exerciseLabel)}</summary>${t.segments.map((s) => `<p><strong>${escapeHtml(s.speaker)}:</strong> ${escapeHtml(s.text)}</p>`).join('')}</details>`).join('')}
        <br>
        <label>Instructions<br><textarea class="tbInstructions" rows="2" style="width:100%">${escapeHtml(ex.instructions || '')}</textarea></label><br>
        <label>Content (JSON)<br><textarea class="tbContent" rows="4" style="width:100%">${escapeHtml(JSON.stringify(ex.content, null, 2))}</textarea></label><br>
        <label><input type="checkbox" class="tbVerified" ${ex.answerKeyVerified ? 'checked' : ''}> Mark reviewed/verified</label>
        <button type="button" class="tbSaveBtn">Save</button>
        <span class="tbSaveError" style="color:#b00"></span>
      </div>
    `;
  }
}

function escapeHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
