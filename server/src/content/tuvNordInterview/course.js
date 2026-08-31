// Course metadata for the TÜV NORD interview-prep course. Only Lesson 1 has
// real content (lessons/l01.js); everything else here is deliberately
// sparse - per the brief, fake content is not to be generated for L02–L18.
// L02's title was given directly; L03–L18 have no authored title or phase
// yet (tuv-nord-course-state.md doesn't define a lesson-to-phase mapping,
// only a move-to-phase one), so they render as generic locked placeholders.

import { l01 } from './lessons/l01.js';

export const COURSE_ID = 'tuv-nord-interview';

// Canonical phase names, spec §2.
export const PHASES = [
  { number: 1, name: 'Bootstrap' },
  { number: 2, name: 'Paradigm & range expansion' },
  { number: 3, name: 'Subordination & abstraction' },
  { number: 4, name: 'Depth & productivity' },
  { number: 5, name: 'Narration & application' },
];

const lessonMeta = [
  { id: 'l01', phase: 1, title: l01.title, prerequisites: [], hasContent: true },
  { id: 'l02', phase: 1, title: 'Point every answer at the job', prerequisites: ['l01'], hasContent: false },
  ...Array.from({ length: 16 }, (_, i) => {
    const n = i + 3;
    const id = `l${String(n).padStart(2, '0')}`;
    const prevId = `l${String(n - 1).padStart(2, '0')}`;
    return { id, phase: null, title: null, prerequisites: [prevId], hasContent: false };
  }),
];

export const course = {
  id: COURSE_ID,
  title: 'TÜV NORD Food GPT',
  subtitle: 'Interviewtraining auf Deutsch',
  description: 'Spoken interview preparation for the TÜV NORD Food & Near Food working student role, built as a stateful, cumulative lesson sequence rather than static articles.',
  lessonCount: lessonMeta.length,
  phaseCount: PHASES.length,
  speakingFocused: true,
  phases: PHASES,
  lessons: lessonMeta,
};

const lessonContent = { l01 };

export function getLessonContent(lessonId) {
  return lessonContent[lessonId] || null;
}
