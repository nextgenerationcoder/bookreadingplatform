import { api } from '../api.js';

const COLLAPSE_KEY = 'interviewSidebarCollapsed';

// Builds the two-pane Interview layout (left lesson sidebar + content area)
// shared by all three Interview views (list, add lesson, lesson player), so
// you can jump to a different lesson without leaving the section. Combines
// static lessons (bundled at build time) with DB-backed ones (see
// server/src/interviewLessonImporter.js). Returns the empty content host for
// the caller to render its own view into.
export async function renderInterviewShell(host, staticLessons, activeCourseId) {
  host.innerHTML = `
    <div class="interviewLayout">
      <aside class="interviewSidebar" id="interviewSidebar">
        <div class="interviewSidebarHeader">
          <span class="interviewSidebarTitle">Lessons</span>
          <button type="button" id="interviewSidebarToggle" class="interviewSidebarToggle" aria-label="Toggle lessons sidebar"></button>
        </div>
        <div class="interviewSidebarList" id="interviewSidebarList">
          <div class="loading">Loading…</div>
        </div>
        <a href="#/add-interview-lesson" class="interviewSidebarAdd">+ Add Lesson</a>
      </aside>
      <div class="interviewContent" id="interviewContent"></div>
    </div>
  `;

  const sidebar = host.querySelector('#interviewSidebar');
  const toggle = host.querySelector('#interviewSidebarToggle');
  const list = host.querySelector('#interviewSidebarList');
  const contentHost = host.querySelector('#interviewContent');

  const applyCollapsed = (collapsed) => {
    sidebar.classList.toggle('collapsed', collapsed);
    toggle.textContent = collapsed ? '▸' : '◂';
  };
  applyCollapsed(localStorage.getItem(COLLAPSE_KEY) === '1');

  toggle.onclick = () => {
    const collapsed = !sidebar.classList.contains('collapsed');
    applyCollapsed(collapsed);
    localStorage.setItem(COLLAPSE_KEY, collapsed ? '1' : '0');
  };

  let dbLessons = [];
  try {
    dbLessons = await api.listInterviewLessons();
  } catch {
    // The sidebar still shows the static lessons if this fails - not worth
    // blocking the whole Interview section over a list refresh.
  }
  const dbIds = new Set(dbLessons.map((l) => l.courseId));
  const staticCards = staticLessons.filter((l) => !dbIds.has(l.courseId)).map((l) => ({ courseId: l.courseId, title: l.title }));
  const allLessons = [...staticCards, ...dbLessons];

  list.innerHTML = allLessons.length
    ? allLessons
        .map(
          (l) =>
            `<a href="#/interview/${encodeURIComponent(l.courseId)}" class="interviewSidebarLink${l.courseId === activeCourseId ? ' active' : ''}" title="${escapeAttr(l.title)}">${escapeHtml(l.title)}</a>`
        )
        .join('')
    : '<div class="interviewSidebarEmpty">No lessons yet.</div>';

  return contentHost;
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function escapeAttr(str) {
  return str.replace(/"/g, '&quot;');
}
