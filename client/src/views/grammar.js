import { api } from '../api.js';

const LEVEL_LABELS = {
  A1: 'A1 — Beginner',
  A2: 'A2 — Elementary',
  B1: 'B1 — Intermediate',
  B2: 'B2 — Upper Intermediate',
  C1: 'C1 — Advanced',
  C2: 'C2 — Proficient',
};

export async function renderGrammarList(host, level) {
  host.innerHTML = '<div class="loading">Loading grammar lessons…</div>';

  let lessons;
  try {
    lessons = await api.listGrammarLessons(level);
  } catch (err) {
    host.innerHTML = `<div class="error">Failed to load grammar lessons.<br><small>${err.message}</small></div>`;
    return;
  }

  host.innerHTML = `
    <div class="libraryHeader">
      <a href="#/courses" class="backLink">← Levels</a>
      <h1>${LEVEL_LABELS[level] || level}</h1>
    </div>
    <div class="subTabs">
      <a href="#/courses/${level}" class="subTab">Speaking</a>
      <a href="#/courses/${level}/grammar" class="subTab active">Grammar</a>
    </div>
    <div class="bookGrid"></div>
  `;

  const grid = host.querySelector('.bookGrid');
  if (!lessons.length) {
    grid.innerHTML = '<div class="loading">No grammar lessons at this level yet.</div>';
    return;
  }

  for (const lesson of lessons) {
    const card = document.createElement('a');
    card.className = 'bookCard';
    card.href = `#/grammar/${encodeURIComponent(lesson.id)}`;
    card.innerHTML = `
      <span class="bookCardTitle">${escapeHtml(lesson.topic)}</span>
      <div class="bookCardMeta">${escapeHtml(lesson.summary)}</div>
    `;
    grid.appendChild(card);
  }
}

export async function renderGrammarLesson(host, lessonId) {
  host.innerHTML = '<div class="loading">Loading lesson…</div>';

  let lesson;
  try {
    lesson = await api.getGrammarLesson(lessonId);
  } catch (err) {
    host.innerHTML = `<div class="error">Failed to load lesson.<br><small>${err.message}</small></div>`;
    return;
  }

  host.innerHTML = `
    <div class="libraryHeader">
      <a href="#/courses/${lesson.level}/grammar" class="backLink">← ${lesson.level} Grammar</a>
      <h1>${escapeHtml(lesson.topic)}</h1>
    </div>
    <div class="formPage">
      <p>${escapeHtml(lesson.explanation)}</p>

      <h3>Rules</h3>
      <ul class="grammarRules">
        ${lesson.rules.map((r) => `
          <li>
            <div>${escapeHtml(r.rule)}</div>
            ${r.note ? `<div class="lessonHint">${escapeHtml(r.note)}</div>` : ''}
          </li>
        `).join('')}
      </ul>

      <h3>Examples</h3>
      <ul class="grammarExamples">
        ${lesson.examples.map((ex) => `
          <li><span class="grammarDe">${escapeHtml(ex.de)}</span> — <span class="grammarEn">${escapeHtml(ex.en)}</span></li>
        `).join('')}
      </ul>

      <h3>Common mistakes</h3>
      <ul class="grammarMistakes">
        ${lesson.commonMistakes.map((m) => `
          <li>
            <div class="grammarWrong">❌ ${escapeHtml(m.wrong)}</div>
            <div class="grammarRight">✅ ${escapeHtml(m.right)}</div>
            <div class="lessonHint">${escapeHtml(m.why)}</div>
          </li>
        `).join('')}
      </ul>
    </div>
  `;
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str == null ? '' : str;
  return div.innerHTML;
}
