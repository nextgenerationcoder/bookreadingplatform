import { api } from '../api.js';

// Lists every Interview lesson - the static ones bundled at build time
// (client/src/lessons/*.js, registered in main.js's STATIC_INTERVIEW_LESSONS)
// plus any imported later through Add Lesson (stored server-side, see
// server/src/interviewLessonImporter.js).
export async function renderInterviewHome(host, staticLessons) {
  host.innerHTML = '<div class="loading">Loading lessons…</div>';

  let dbLessons;
  try {
    dbLessons = await api.listInterviewLessons();
  } catch (err) {
    host.innerHTML = `<div class="error">Failed to load lessons.<br><small>${err.message}</small></div>`;
    return;
  }

  const dbIds = new Set(dbLessons.map((l) => l.courseId));
  const staticCards = staticLessons
    .filter((l) => !dbIds.has(l.courseId))
    .map((l) => ({ courseId: l.courseId, title: l.title, stepCount: l.steps.length }));
  const cards = [...staticCards, ...dbLessons];

  host.innerHTML = `
    <div class="libraryHeader">
      <h1>Interview</h1>
      <a class="button" href="#/add-interview-lesson">+ Add Lesson</a>
    </div>
    <div class="bookGrid"></div>
  `;

  const grid = host.querySelector('.bookGrid');
  if (!cards.length) {
    grid.innerHTML = `<div class="loading">No lessons yet. <a href="#/add-interview-lesson">Add one</a>.</div>`;
    return;
  }

  for (const lesson of cards) {
    const card = document.createElement('a');
    card.className = 'bookCard';
    card.href = `#/interview/${encodeURIComponent(lesson.courseId)}`;
    card.innerHTML = `
      <span class="bookCardTitle">${escapeHtml(lesson.title)}</span>
      <div class="bookCardMeta">${lesson.stepCount} step${lesson.stepCount === 1 ? '' : 's'}</div>
    `;
    grid.appendChild(card);
  }
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}
