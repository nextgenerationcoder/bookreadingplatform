import { api } from '../api.js';

const LEVEL_LABELS = {
  A1: 'A1 — Beginner',
  A2: 'A2 — Elementary',
  B1: 'B1 — Intermediate',
  B2: 'B2 — Upper Intermediate',
  C1: 'C1 — Advanced',
  C2: 'C2 — Proficient',
};

export async function renderCourseLevels(host) {
  host.innerHTML = '<div class="loading">Loading levels…</div>';

  let levels, courses;
  try {
    [levels, courses] = await Promise.all([api.getCourseLevels(), api.listCourses()]);
  } catch (err) {
    host.innerHTML = `<div class="error">Failed to load courses.<br><small>${err.message}</small></div>`;
    return;
  }

  const countByLevel = {};
  for (const course of courses) countByLevel[course.level] = (countByLevel[course.level] || 0) + 1;

  host.innerHTML = `
    <div class="libraryHeader">
      <h1>Courses</h1>
      <a class="button" href="#/add-course">+ Add Course</a>
    </div>
    <div class="bookGrid"></div>
  `;

  const grid = host.querySelector('.bookGrid');
  for (const level of levels.levels || levels) {
    const card = document.createElement('a');
    card.className = 'bookCard';
    card.href = `#/courses/${level}`;
    const count = countByLevel[level] || 0;
    card.innerHTML = `
      <span class="bookCardTitle">${LEVEL_LABELS[level] || level}</span>
      <div class="bookCardMeta">${count} course${count === 1 ? '' : 's'}</div>
    `;
    grid.appendChild(card);
  }
}

export async function renderCourseList(host, level) {
  host.innerHTML = '<div class="loading">Loading courses…</div>';

  let courses;
  try {
    courses = await api.listCourses(level);
  } catch (err) {
    host.innerHTML = `<div class="error">Failed to load courses.<br><small>${err.message}</small></div>`;
    return;
  }

  host.innerHTML = `
    <div class="libraryHeader">
      <a href="#/courses" class="backLink">← Levels</a>
      <h1>${LEVEL_LABELS[level] || level}</h1>
      <a class="button" href="#/add-course?level=${level}">+ Add Course</a>
    </div>
    <div class="bookGrid"></div>
  `;

  const grid = host.querySelector('.bookGrid');
  if (!courses.length) {
    grid.innerHTML = `<div class="loading">No courses at this level yet. <a href="#/add-course?level=${level}">Add one</a>.</div>`;
    return;
  }

  for (const course of courses) {
    grid.appendChild(renderCourseCard(course));
  }
}

function renderCourseCard(course) {
  const card = document.createElement('div');
  card.className = 'bookCard';
  card.innerHTML = `
    <a class="bookCardTitle" href="#/course/${encodeURIComponent(course.id)}">${escapeHtml(course.title)}</a>
    <div class="bookCardMeta">
      ${course.language.source.toUpperCase()} → ${course.language.target.toUpperCase()}
      · ${course.pageCount} pages (${course.firstPage}–${course.lastPage})
    </div>
    <div class="bookCardActions">
      <button class="linkButton" data-action="rename">✏️ Edit name</button>
      <a class="linkButton" href="#/course/${encodeURIComponent(course.id)}/add-pages">+ Add Pages</a>
    </div>
    <div class="renameBox" hidden>
      <input type="text" class="renameInput" value="${escapeAttr(course.title)}">
      <div class="renameActions">
        <button data-action="save">Save</button>
        <button data-action="cancel">Cancel</button>
      </div>
      <div class="renameStatus"></div>
    </div>
  `;

  const titleEl = card.querySelector('.bookCardTitle');
  const renameBtn = card.querySelector('[data-action="rename"]');
  const renameBox = card.querySelector('.renameBox');
  const renameInput = card.querySelector('.renameInput');
  const saveBtn = card.querySelector('[data-action="save"]');
  const cancelBtn = card.querySelector('[data-action="cancel"]');
  const status = card.querySelector('.renameStatus');

  renameBtn.onclick = () => {
    renameBox.hidden = false;
    renameBtn.parentElement.hidden = true;
    renameInput.value = course.title;
    renameInput.focus();
    renameInput.select();
  };

  cancelBtn.onclick = () => {
    renameBox.hidden = true;
    renameBtn.parentElement.hidden = false;
    status.textContent = '';
  };

  saveBtn.onclick = async () => {
    const newTitle = renameInput.value.trim();
    if (!newTitle) {
      status.textContent = 'Name cannot be empty.';
      status.className = 'renameStatus error';
      return;
    }
    saveBtn.disabled = true;
    try {
      const meta = await api.renameCourse(course.id, newTitle);
      course.title = meta.title;
      titleEl.textContent = meta.title;
      renameBox.hidden = true;
      renameBtn.parentElement.hidden = false;
      status.textContent = '';
    } catch (err) {
      status.textContent = `Error: ${err.message}`;
      status.className = 'renameStatus error';
    } finally {
      saveBtn.disabled = false;
    }
  };

  return card;
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function escapeAttr(str) {
  return str.replace(/"/g, '&quot;');
}
