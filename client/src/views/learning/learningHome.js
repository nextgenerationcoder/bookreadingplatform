import { api } from '../../api.js';

export async function renderLearningHome(host) {
  host.innerHTML = '<div class="loading">Loading…</div>';

  let courses;
  try {
    courses = await api.listLearningCourses();
  } catch (err) {
    host.innerHTML = `<div class="error">Couldn't load courses.<br><small>${err.message}</small></div>`;
    return;
  }

  if (!courses.length) {
    host.innerHTML = '<div class="loading">No courses yet.</div>';
    return;
  }

  host.innerHTML = `
    <div class="libraryHeader">
      <h1>Learning</h1>
    </div>
    <div class="bookGrid"></div>
  `;

  const grid = host.querySelector('.bookGrid');
  for (const c of courses) {
    const card = document.createElement('a');
    card.className = 'bookCard';
    card.href = `#/learning/${encodeURIComponent(c.id)}`;
    card.innerHTML = `
      <span class="bookCardTitle">${escapeHtml(c.title)}</span>
      <div class="bookCardMeta">${escapeHtml(c.subtitle)}</div>
      <div class="bookCardMeta" style="margin-top:6px">
        ${c.lessonCount} lessons · ${c.phaseCount} phases${c.speakingFocused ? ' · Speaking-focused' : ''}
      </div>
      ${c.lessonsCompleted ? `<div class="bookCardMeta" style="margin-top:6px">${c.lessonsCompleted} lesson${c.lessonsCompleted === 1 ? '' : 's'} completed</div>` : ''}
    `;
    grid.appendChild(card);
  }
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}
