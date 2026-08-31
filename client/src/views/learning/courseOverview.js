import { api } from '../../api.js';

const STATUS_LABEL = {
  completed: '✓ Completed',
  in_progress: 'In progress',
  available: 'Start',
  locked: 'Locked',
};

export async function renderCourseOverview(host, courseId) {
  host.innerHTML = '<div class="loading">Loading…</div>';

  let data;
  try {
    data = await api.getLearningCourse(courseId);
  } catch (err) {
    host.innerHTML = `<div class="error">Couldn't load this course.<br><small>${err.message}</small></div>`;
    return;
  }

  host.innerHTML = `
    <div class="formPage">
      <a href="#/learning" class="backLink">← Learning</a>
      <h1>${escapeHtml(data.title)}</h1>
      <p class="hint" style="padding:0">${escapeHtml(data.subtitle)}</p>
      <div class="phaseGroups"></div>
    </div>
  `;

  const groups = host.querySelector('.phaseGroups');
  for (const phase of data.phases) {
    const lessonsInPhase = data.lessons.filter((l) => l.phase === phase.number);
    if (!lessonsInPhase.length) continue;
    const section = document.createElement('div');
    section.className = 'phaseGroup';
    section.innerHTML = `<h2 class="phaseHeader">Phase ${phase.number} — ${escapeHtml(phase.name)}</h2>`;
    for (const lesson of lessonsInPhase) {
      section.appendChild(renderLessonRow(courseId, lesson));
    }
    groups.appendChild(section);
  }

  const otherLessons = data.lessons.filter((l) => l.phase == null);
  if (otherLessons.length) {
    const section = document.createElement('div');
    section.className = 'phaseGroup';
    section.innerHTML = `<h2 class="phaseHeader">Later lessons</h2><p class="hint" style="padding:0 0 8px">Unlock as you complete the lessons before them.</p>`;
    for (const lesson of otherLessons) {
      section.appendChild(renderLessonRow(courseId, lesson));
    }
    groups.appendChild(section);
  }
}

function renderLessonRow(courseId, lesson) {
  const row = document.createElement(lesson.status === 'locked' ? 'div' : 'a');
  row.className = `lessonRow lessonRow-${lesson.status}`;
  if (lesson.status !== 'locked') row.href = `#/learning/${encodeURIComponent(courseId)}/${encodeURIComponent(lesson.id)}`;
  row.innerHTML = `
    <span class="lessonRowTitle">${escapeHtml(lesson.title || `Lesson ${lesson.id.replace(/\D/g, '')}`)}</span>
    <span class="lessonRowStatus">${lesson.status === 'locked' && !lesson.hasContent ? 'Coming next' : STATUS_LABEL[lesson.status]}</span>
  `;
  return row;
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}
