// Two kinds of AI calls, both using a user's own API key:
//
// - Vision (formatPageFromImage): reads a photo of a page directly - used by
//   the page-photo batch upload in Add Pages. Only vision-capable providers.
// - Text (formatPageFromText): takes already-extracted German text (e.g.
//   from a PDF's text layer) and translates+formats it - used by the whole-
//   book PDF import pipeline. Any text-chat provider, including DeepSeek,
//   which has no vision API at all.

const VISION_PROVIDERS = {
  anthropic: {
    model: 'claude-haiku-4-5-20251001',
    async call(apiKey, systemPrompt, imageBase64, mimeType) {
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: VISION_PROVIDERS.anthropic.model,
          max_tokens: 2000,
          system: systemPrompt,
          messages: [
            {
              role: 'user',
              content: [
                { type: 'image', source: { type: 'base64', media_type: mimeType, data: imageBase64 } },
                { type: 'text', text: 'Transcribe and translate this page photo as instructed.' },
              ],
            },
          ],
        }),
        signal: AbortSignal.timeout(60000),
      });
      if (!res.ok) throw new Error(`Anthropic API error (${res.status}): ${await res.text().catch(() => res.statusText)}`);
      const data = await res.json();
      return data.content?.[0]?.text || '';
    },
  },
  openai: {
    model: 'gpt-4o-mini',
    async call(apiKey, systemPrompt, imageBase64, mimeType) {
      const res = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: VISION_PROVIDERS.openai.model,
          messages: [
            { role: 'system', content: systemPrompt },
            {
              role: 'user',
              content: [
                { type: 'text', text: 'Transcribe and translate this page photo as instructed.' },
                { type: 'image_url', image_url: { url: `data:${mimeType};base64,${imageBase64}` } },
              ],
            },
          ],
        }),
        signal: AbortSignal.timeout(60000),
      });
      if (!res.ok) throw new Error(`OpenAI API error (${res.status}): ${await res.text().catch(() => res.statusText)}`);
      const data = await res.json();
      return data.choices?.[0]?.message?.content || '';
    },
  },
};

// OpenAI-compatible chat-completions shape, used by both openai and
// deepseek (deepseek's API is intentionally OpenAI-compatible).
async function openAiCompatibleTextCall(url, model, apiKey, systemPrompt, userText) {
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userText },
      ],
    }),
    signal: AbortSignal.timeout(60000),
  });
  if (!res.ok) throw new Error(`API error (${res.status}): ${await res.text().catch(() => res.statusText)}`);
  const data = await res.json();
  return data.choices?.[0]?.message?.content || '';
}

const TEXT_PROVIDERS = {
  anthropic: {
    model: 'claude-haiku-4-5-20251001',
    async call(apiKey, systemPrompt, userText) {
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: TEXT_PROVIDERS.anthropic.model,
          max_tokens: 2000,
          system: systemPrompt,
          messages: [{ role: 'user', content: userText }],
        }),
        signal: AbortSignal.timeout(60000),
      });
      if (!res.ok) throw new Error(`Anthropic API error (${res.status}): ${await res.text().catch(() => res.statusText)}`);
      const data = await res.json();
      return data.content?.[0]?.text || '';
    },
  },
  openai: {
    model: 'gpt-4o-mini',
    call: (apiKey, systemPrompt, userText) =>
      openAiCompatibleTextCall('https://api.openai.com/v1/chat/completions', TEXT_PROVIDERS.openai.model, apiKey, systemPrompt, userText),
  },
  deepseek: {
    model: 'deepseek-chat',
    call: (apiKey, systemPrompt, userText) =>
      openAiCompatibleTextCall('https://api.deepseek.com/chat/completions', TEXT_PROVIDERS.deepseek.model, apiKey, systemPrompt, userText),
  },
};

export const LLM_PROVIDERS = Object.keys(TEXT_PROVIDERS);
export const VISION_CAPABLE_PROVIDERS = Object.keys(VISION_PROVIDERS);

function buildVisionSystemPrompt(pageNumber, chapter) {
  return [
    'You transcribe a photo of a German book page and translate it into Persian, for a bilingual',
    'reading app. Read every sentence on the page in order, correcting for photo/scan artifacts using',
    'context, translate each sentence into fluent, natural Persian, and reply with ONLY the following',
    'format - no other commentary, explanation, or markdown fences. If the photo has no readable German',
    `text at all, reply with exactly: NO_TEXT_FOUND`,
    '',
    `PAGE ${pageNumber}`,
    chapter ? `CHAPTER: ${chapter}` : null,
    '1: <German sentence exactly as printed, OCR/scan artifacts corrected>',
    '<Persian translation>',
    '2: <next German sentence>',
    '<Persian translation>',
    '(continue numbering for every sentence on the page)',
  ]
    .filter(Boolean)
    .join('\n');
}

export async function formatPageFromImage({ provider, apiKey, imageBase64, mimeType, pageNumber, chapter }) {
  const impl = VISION_PROVIDERS[provider];
  if (!impl) throw new Error(`"${provider}" doesn't support reading photos (no vision API) - use Anthropic or OpenAI for this.`);
  const systemPrompt = buildVisionSystemPrompt(pageNumber, chapter);
  const result = await impl.call(apiKey, systemPrompt, imageBase64, mimeType);
  return result.trim();
}

function buildTextSystemPrompt(pageNumber, chapter) {
  return [
    'You receive raw German text extracted from one page of a book (via a PDF text layer or OCR, so',
    'it may contain minor extraction artifacts: stray line breaks, hyphenation, or misread characters).',
    'Reconstruct the intended sentences, correcting obvious extraction mistakes using context, translate',
    'each sentence into fluent, natural Persian, and reply with ONLY the following format - no other',
    'commentary, explanation, or markdown fences. If the text has no real content at all, reply with',
    'exactly: NO_TEXT_FOUND',
    '',
    `PAGE ${pageNumber}`,
    chapter ? `CHAPTER: ${chapter}` : null,
    '1: <corrected German sentence>',
    '<Persian translation>',
    '2: <next German sentence>',
    '<Persian translation>',
    '(continue numbering for every sentence found in the text)',
  ]
    .filter(Boolean)
    .join('\n');
}

export async function formatPageFromText({ provider, apiKey, rawText, pageNumber, chapter }) {
  const impl = TEXT_PROVIDERS[provider];
  if (!impl) throw new Error(`Unsupported AI provider: ${provider}`);
  const systemPrompt = buildTextSystemPrompt(pageNumber, chapter);
  const result = await impl.call(apiKey, systemPrompt, rawText);
  return result.trim();
}
