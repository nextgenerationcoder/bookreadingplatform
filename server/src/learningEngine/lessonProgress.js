// Lesson lock/unlock computation, driven purely by each lesson's declared
// `prerequisites` (lesson ids) and this account's saved progress rows.
// Kept separate from the DB/route layer so it's directly unit-testable.

export function computeLessonStatuses(lessons, progressRows) {
  const completedSet = new Set(progressRows.filter((r) => r.status === 'completed').map((r) => r.lesson_id));
  const inProgressSet = new Set(progressRows.filter((r) => r.status === 'in_progress').map((r) => r.lesson_id));

  return lessons.map((lesson) => {
    const prereqsMet = (lesson.prerequisites || []).every((id) => completedSet.has(id));
    let status;
    if (completedSet.has(lesson.id)) status = 'completed';
    else if (!lesson.hasContent) status = 'locked'; // no real lesson content authored yet, regardless of prerequisites
    else if (!prereqsMet) status = 'locked';
    else if (inProgressSet.has(lesson.id)) status = 'in_progress';
    else status = 'available';
    return { id: lesson.id, phase: lesson.phase, title: lesson.title, hasContent: lesson.hasContent, status };
  });
}
