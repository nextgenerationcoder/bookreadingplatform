import test from 'node:test';
import assert from 'node:assert/strict';

const { translateWordInContext } = await import('../llm.js');

function mockAnthropicTextResponse(text) {
  const originalFetch = globalThis.fetch;
  let capturedBody = null;
  globalThis.fetch = async (url, opts) => {
    capturedBody = JSON.parse(opts.body);
    return { ok: true, json: async () => ({ content: [{ type: 'text', text }] }) };
  };
  return { restore: () => { globalThis.fetch = originalFetch; }, getCapturedBody: () => capturedBody };
}

test('translateWordInContext sends the word and its sentence, returns the trimmed translation', async () => {
  const mock = mockAnthropicTextResponse('  سگ  ');
  try {
    const translation = await translateWordInContext({
      provider: 'anthropic',
      apiKey: 'fake-key',
      word: 'Hund',
      sentence: 'Der Hund bellt laut.',
    });
    assert.equal(translation, 'سگ');
    const body = mock.getCapturedBody();
    assert.match(body.messages[0].content, /Der Hund bellt laut\./);
    assert.match(body.messages[0].content, /Word to translate \(in context\): Hund/);
    assert.match(body.system, /as it is actually used in the given sentence/);
  } finally {
    mock.restore();
  }
});

test('translateWordInContext rejects an unsupported provider before making any network call', async () => {
  await assert.rejects(
    translateWordInContext({ provider: 'not-real', apiKey: 'x', word: 'y', sentence: 'z' }),
    /Unsupported AI provider/
  );
});

test('translateWordInContext surfaces a clear error when the provider API call fails', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: false, status: 401, text: async () => 'invalid key' });
  try {
    await assert.rejects(
      translateWordInContext({ provider: 'anthropic', apiKey: 'bad', word: 'x', sentence: 'y' }),
      /Anthropic API error \(401\)/
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});
