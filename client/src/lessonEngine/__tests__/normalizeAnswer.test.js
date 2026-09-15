import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeAnswer, answersMatch } from '../normalizeAnswer.js';

test('trims and lowercases', () => {
  assert.equal(normalizeAnswer('  Es ist gut  '), 'es ist gut');
});

test('collapses multiple internal spaces', () => {
  assert.equal(normalizeAnswer('Es   ist    gut'), 'es ist gut');
});

test('a trailing period is optional', () => {
  assert.equal(normalizeAnswer('Es ist gut.'), normalizeAnswer('Es ist gut'));
});

test('a trailing question mark is optional', () => {
  assert.equal(normalizeAnswer('Wollen Sie kommen?'), normalizeAnswer('Wollen Sie kommen'));
});

test('answersMatch accepts case/spacing/punctuation variants', () => {
  assert.ok(answersMatch('es ist gut', 'Es ist gut.'));
  assert.ok(answersMatch('  ES IST GUT  ', 'Es ist gut.'));
  assert.ok(answersMatch('Es ist gut', 'Es ist gut.'));
});

test('answersMatch still requires correct word order', () => {
  assert.ok(!answersMatch('gut ist Es', 'Es ist gut.'));
});

test('answersMatch rejects a different sentence entirely', () => {
  assert.ok(!answersMatch('Was wollen Sie trinken?', 'Was wollen Sie essen?'));
});
