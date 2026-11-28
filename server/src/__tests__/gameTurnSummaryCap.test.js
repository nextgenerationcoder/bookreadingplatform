import test from 'node:test';
import assert from 'node:assert/strict';
import { generateGameTurn } from '../llm.js';

function mockTurnResponse(summary) {
  return new Response(
    JSON.stringify({
      content: [
        {
          type: 'tool_use',
          name: 'record_turn',
          input: {
            outcome: '',
            scene: 'Ein ruhiger Moment im Büro.',
            choices: [
              { text: 'A', tags: { frech: 0, chef_sieht: false, betrifft: null, flirt: false, check: null } },
              { text: 'B', tags: { frech: 1, chef_sieht: false, betrifft: null, flirt: false, check: null } },
            ],
            summary,
            words_used: [],
          },
        },
      ],
    }),
    { status: 200 }
  );
}

test('generateGameTurn caps an over-long summary instead of letting it grow prompts over time', async () => {
  const realFetch = globalThis.fetch;
  const hugeSummary = 'Ein Satz. '.repeat(200); // ~2000 chars, far past any "1-2 sentence recap"
  globalThis.fetch = async () => mockTurnResponse(hugeSummary);
  try {
    const result = await generateGameTurn({ provider: 'anthropic', apiKey: 'sk-fake', systemPrompt: 'x', userText: 'y' });
    assert.ok(result.summary.length <= 600, `expected the summary to be capped, got ${result.summary.length} chars`);
    assert.ok(result.summary.length > 0);
  } finally {
    globalThis.fetch = realFetch;
  }
});

test('generateGameTurn leaves a normal short summary untouched', async () => {
  const realFetch = globalThis.fetch;
  const shortSummary = 'Der Spieler hat Kaffee geholt und mit Jonas geplaudert.';
  globalThis.fetch = async () => mockTurnResponse(shortSummary);
  try {
    const result = await generateGameTurn({ provider: 'anthropic', apiKey: 'sk-fake', systemPrompt: 'x', userText: 'y' });
    assert.equal(result.summary, shortSummary);
  } finally {
    globalThis.fetch = realFetch;
  }
});
