import test from 'node:test';
import assert from 'node:assert/strict';

const { answerQuestion } = await import('../llm.js');

function mockAnthropicTextResponse(text) {
  const originalFetch = globalThis.fetch;
  let capturedBody = null;
  globalThis.fetch = async (url, opts) => {
    capturedBody = JSON.parse(opts.body);
    return { ok: true, json: async () => ({ content: [{ type: 'text', text }] }) };
  };
  return { restore: () => { globalThis.fetch = originalFetch; }, getCapturedBody: () => capturedBody };
}

test('answerQuestion sends the question and returns the plain text reply', async () => {
  const mock = mockAnthropicTextResponse('Antwort: "Darüber" bezieht sich auf den vorherigen Satz.');
  try {
    const answer = await answerQuestion({ provider: 'anthropic', apiKey: 'fake-key', question: 'Worauf bezieht sich "Darüber"?' });
    assert.equal(answer, 'Antwort: "Darüber" bezieht sich auf den vorherigen Satz.');
    const body = mock.getCapturedBody();
    assert.equal(body.messages[0].content, 'Worauf bezieht sich "Darüber"?');
    assert.equal(body.messages[0].role, 'user');
  } finally {
    mock.restore();
  }
});

test('answerQuestion rejects an unsupported provider before making any network call', async () => {
  await assert.rejects(answerQuestion({ provider: 'not-real', apiKey: 'x', question: 'y' }), /Unsupported AI provider/);
});

test('answerQuestion surfaces a clear error when the provider API call fails', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: false, status: 401, text: async () => 'invalid key' });
  try {
    await assert.rejects(answerQuestion({ provider: 'anthropic', apiKey: 'bad', question: 'x' }), /Anthropic API error \(401\)/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
