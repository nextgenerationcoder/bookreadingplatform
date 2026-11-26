import test from 'node:test';
import assert from 'node:assert/strict';

const { findGermanForPersian } = await import('../llm.js');

function mockAnthropicTextResponse(text) {
  const originalFetch = globalThis.fetch;
  let capturedBody = null;
  globalThis.fetch = async (url, opts) => {
    capturedBody = JSON.parse(opts.body);
    return { ok: true, json: async () => ({ content: [{ type: 'text', text }] }) };
  };
  return { restore: () => { globalThis.fetch = originalFetch; }, getCapturedBody: () => capturedBody };
}

test('findGermanForPersian sends both sentences and the Persian phrase, returns the trimmed answer', async () => {
  const mock = mockAnthropicTextResponse('  ein verbreitetes Phänomen  ');
  try {
    const answer = await findGermanForPersian({
      provider: 'anthropic',
      apiKey: 'fake-key',
      persianPhrase: 'پدیده‌ای رایج',
      germanSentence: 'Im Iran ist Auswanderung ebenfalls ein verbreitetes Phänomen.',
      persianSentence: 'در ایران هم مهاجرت پدیده‌ای رایج است.',
    });
    assert.equal(answer, 'ein verbreitetes Phänomen');
    const body = mock.getCapturedBody();
    assert.match(body.messages[0].content, /German sentence: Im Iran ist Auswanderung/);
    assert.match(body.messages[0].content, /Persian translation: در ایران/);
    assert.match(body.messages[0].content, /Persian word\/phrase to match: پدیده‌ای رایج/);
    assert.match(body.system, /exact substring of the German sentence/);
  } finally {
    mock.restore();
  }
});

test('findGermanForPersian rejects an unsupported provider before making any network call', async () => {
  await assert.rejects(
    findGermanForPersian({ provider: 'not-real', apiKey: 'x', persianPhrase: 'y', germanSentence: 'z', persianSentence: 'w' }),
    /Unsupported AI provider/
  );
});

test('findGermanForPersian surfaces a clear error when the provider API call fails', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: false, status: 401, text: async () => 'invalid key' });
  try {
    await assert.rejects(
      findGermanForPersian({ provider: 'anthropic', apiKey: 'bad', persianPhrase: 'x', germanSentence: 'y', persianSentence: 'z' }),
      /Anthropic API error \(401\)/
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});
