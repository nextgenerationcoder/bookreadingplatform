import { api } from '../api.js';

// Practice: personalized courses generated from the learner's own
// known/learning vocabulary (vocab_progress) and ranked grammar targets
// (grammar_lessons), via server/src/practiceCourseGenerator.js. Rendered
// the same way as any other course - renderLessonPlayer, unchanged - once
// its lessons are converted into that shape server-side.
export async function renderPractice(host) {
  host.innerHTML = '<div class="loading">Loading your practice courses…</div>';

  let courses;
  try {
    courses = await api.listPracticeCourses();
  } catch (err) {
    host.innerHTML = `<div class="error">Failed to load practice courses.<br><small>${err.message}</small></div>`;
    return;
  }

  host.innerHTML = `
    <div class="libraryHeader">
      <h1>Practice</h1>
      <button class="button" id="generateBtn" type="button">+ Generate a practice course</button>
    </div>
    <p class="hint">
      Builds a course from the words you already know and are learning, plus the grammar you most need to
      practice next. Each generation can take a minute or two.
    </p>
    <div id="generateStatus"></div>
    <div class="bookGrid"></div>
  `;

  const grid = host.querySelector('.bookGrid');
  renderCourseCards(grid, courses);

  const generateBtn = host.querySelector('#generateBtn');
  const status = host.querySelector('#generateStatus');
  generateBtn.onclick = async () => {
    generateBtn.disabled = true;
    status.textContent = 'Generating your course — this can take a minute or two…';
    status.className = 'importStatus';
    try {
      const course = await api.generatePracticeCourse();
      status.textContent = '';
      courses = [{ id: course.id, title: course.title, lessonCount: course.lessonCount, createdAt: course.createdAt }, ...courses];
      renderCourseCards(grid, courses);
    } catch (err) {
      status.textContent = `Error: ${err.message}`;
      status.className = 'importStatus error';
    } finally {
      generateBtn.disabled = false;
    }
  };
}

function renderCourseCards(grid, courses) {
  if (!courses.length) {
    grid.innerHTML = '<div class="loading">No practice courses yet — generate your first one above.</div>';
    return;
  }
  grid.innerHTML = '';
  for (const course of courses) {
    const card = document.createElement('a');
    card.className = 'bookCard';
    card.href = `#/practice/${encodeURIComponent(course.id)}`;
    card.innerHTML = `
      <span class="bookCardTitle">${escapeHtml(course.title)}</span>
      <div class="bookCardMeta">${course.lessonCount} lesson${course.lessonCount === 1 ? '' : 's'}</div>
    `;
    grid.appendChild(card);
  }
}

export async function renderPracticeCourse(host, courseId) {
  host.innerHTML = '<div class="loading">Loading course…</div>';

  let course;
  try {
    course = await api.getPracticeCourse(courseId);
  } catch (err) {
    host.innerHTML = `<div class="error">Failed to load course.<br><small>${err.message}</small></div>`;
    return;
  }

  host.innerHTML = `
    <div class="libraryHeader">
      <a href="#/practice" class="backLink">← Practice</a>
      <h1>${escapeHtml(course.title)}</h1>
    </div>
    <div class="bookGrid"></div>
  `;

  const grid = host.querySelector('.bookGrid');
  course.lessons.forEach((lesson, i) => {
    const card = document.createElement('a');
    card.className = 'bookCard';
    card.href = `#/practice/${encodeURIComponent(courseId)}/${encodeURIComponent(lesson.lessonId)}`;
    card.innerHTML = `
      <span class="bookCardTitle">${escapeHtml(lesson.title)}</span>
      <div class="bookCardMeta">Lesson ${i + 1} · ${lesson.steps.length} steps</div>
    `;
    grid.appendChild(card);
  });
}

export async function loadPracticeLesson(courseId, lessonId) {
  const course = await api.getPracticeCourse(courseId);
  const lesson = course.lessons.find((l) => l.lessonId === lessonId);
  if (!lesson) throw new Error('Lesson not found in this course.');
  return {
    courseId: `practice-${courseId}-${lessonId}`,
    title: `${course.title} — ${lesson.title}`,
    backHref: `#/practice/${encodeURIComponent(courseId)}`,
    backLabel: '← Course',
    storageKey: `practice-lesson-${courseId}-${lessonId}`,
    promptLang: course.promptLang,
    steps: lesson.steps,
  };
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}
