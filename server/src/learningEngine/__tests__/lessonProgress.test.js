import test from 'node:test';
import assert from 'node:assert/strict';
import { computeLessonStatuses } from '../lessonProgress.js';

const lessons = [
  { id: 'l01', phase: 1, title: 'L01', prerequisites: [], hasContent: true },
  { id: 'l02', phase: 1, title: 'L02', prerequisites: ['l01'], hasContent: true },
  { id: 'l03', phase: null, title: null, prerequisites: ['l02'], hasContent: false },
];

test('L01 is available with no progress at all', () => {
  const statuses = computeLessonStatuses(lessons, []);
  assert.equal(statuses.find((l) => l.id === 'l01').status, 'available');
});

test('L02 stays locked before L01 is completed', () => {
  const statuses = computeLessonStatuses(lessons, []);
  assert.equal(statuses.find((l) => l.id === 'l02').status, 'locked');
});

test('L02 unlocks once L01 is completed', () => {
  const statuses = computeLessonStatuses(lessons, [{ lesson_id: 'l01', status: 'completed' }]);
  assert.equal(statuses.find((l) => l.id === 'l02').status, 'available');
});

test('an in-progress lesson is reported as in_progress, not available', () => {
  const statuses = computeLessonStatuses(lessons, [{ lesson_id: 'l01', status: 'in_progress' }]);
  assert.equal(statuses.find((l) => l.id === 'l01').status, 'in_progress');
});

test('a lesson with no authored content stays locked even if prerequisites are met', () => {
  const statuses = computeLessonStatuses(lessons, [
    { lesson_id: 'l01', status: 'completed' },
    { lesson_id: 'l02', status: 'completed' },
  ]);
  assert.equal(statuses.find((l) => l.id === 'l03').status, 'locked');
});
