// Calls a user's own AI API key to read a photo of a book page directly -
// no local OCR step - and produce one page already in our
// PAGE/CHAPTER/"N: sentence" + translation import format: German
// transcription and Persian translation done together, by a model that's
// actually good at both, instead of a local OCR engine plus a crude
// word-by-word translator.

const PROVIDERS = {
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
          model: PROVIDERS.anthropic.model,
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
          model: PROVIDERS.openai.model,
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

export const LLM_PROVIDERS = Object.keys(PROVIDERS);

function buildSystemPrompt(pageNumber, chapter) {
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
  const impl = PROVIDERS[provider];
  if (!impl) throw new Error(`Unsupported AI provider: ${provider}`);
  const systemPrompt = buildSystemPrompt(pageNumber, chapter);
  const result = await impl.call(apiKey, systemPrompt, imageBase64, mimeType);
  return result.trim();
}
