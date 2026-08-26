// Two kinds of AI calls, both using a user's own API key:
//
// - Vision (formatPageFromImage): reads a photo of a page directly - used by
//   the page-photo batch upload in Add Pages. Only vision-capable providers.
// - Text (formatPageFromText): takes already-extracted German text (e.g.
//   from a PDF's text layer) and translates+formats it - used by the whole-
//   book PDF import pipeline. Any text-chat provider, including DeepSeek,
//   which has no vision API at all.
//
// Both return { sentences: [{ de, fa }] } - structured data, not free text
// the model wrote in a format we then have to parse. Earlier this asked the
// model to write its reply as literal "PAGE N / 1: sentence / translation"
// text and parsed that back apart; it didn't reliably comply (especially on
// short pages - a title page with just an author's name, a back-cover
// blurb), and a page whose reply was missing the header line got rejected
// outright. Now the API itself enforces the shape: Anthropic via forced
// tool use, OpenAI via Structured Outputs (json_schema, strict), DeepSeek
// via JSON mode (its OpenAI-compatible API doesn't guarantee a schema, so
// the parsed result is still validated here). buildPageBlock() (in
// bookImporter.js) then builds our PAGE/CHAPTER/"N: sentence" text
// deterministically from that clean data.

const SENTENCE_TOOL_SCHEMA = {
  type: 'object',
  properties: {
    sentences: {
      type: 'array',
      description: 'Every sentence on the page, in reading order. Empty if there is no readable German text at all.',
      items: {
        type: 'object',
        properties: {
          de: { type: 'string', description: 'The German sentence, exactly as printed, with scan/OCR artifacts corrected using context.' },
          fa: { type: 'string', description: 'A fluent, natural Persian translation of that sentence.' },
        },
        required: ['de', 'fa'],
      },
    },
  },
  required: ['sentences'],
};

function validateSentences(parsed) {
  if (!parsed || !Array.isArray(parsed.sentences)) {
    throw new Error('AI response was not in the expected {sentences: [...]} shape');
  }
  return parsed.sentences
    .filter((s) => s && typeof s.de === 'string' && typeof s.fa === 'string' && s.de.trim())
    .map((s) => ({ de: s.de.trim(), fa: s.fa.trim() }));
}

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
          tools: [{ name: 'record_page', description: 'Records the sentences read from this page.', input_schema: SENTENCE_TOOL_SCHEMA }],
          tool_choice: { type: 'tool', name: 'record_page' },
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
      return anthropicToolInput(data);
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
          response_format: openAiJsonSchema(),
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
      return JSON.parse(data.choices?.[0]?.message?.content || '{}');
    },
  },
};

function anthropicToolInput(data) {
  const toolUse = data.content?.find((block) => block.type === 'tool_use');
  if (!toolUse) throw new Error('Anthropic response had no tool_use block');
  return toolUse.input;
}

function openAiJsonSchema() {
  return {
    type: 'json_schema',
    json_schema: {
      name: 'page_sentences',
      strict: true,
      schema: {
        type: 'object',
        properties: {
          sentences: {
            type: 'array',
            items: {
              type: 'object',
              properties: { de: { type: 'string' }, fa: { type: 'string' } },
              required: ['de', 'fa'],
              additionalProperties: false,
            },
          },
        },
        required: ['sentences'],
        additionalProperties: false,
      },
    },
  };
}

// Best-effort JSON extraction for providers (DeepSeek) whose JSON mode
// guarantees valid JSON syntax but not that it matches our schema, and
// which sometimes wrap the object in commentary or a markdown fence despite
// being told not to.
function extractJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) throw new Error(`AI response was not valid JSON: ${text.slice(0, 200)}`);
    return JSON.parse(match[0]);
  }
}

// OpenAI-compatible chat-completions shape, used by both openai and
// deepseek (deepseek's API is intentionally OpenAI-compatible).
async function openAiCompatibleTextCall(url, model, apiKey, systemPrompt, userText, { strictSchema }) {
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      response_format: strictSchema ? openAiJsonSchema() : { type: 'json_object' },
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userText },
      ],
    }),
    signal: AbortSignal.timeout(60000),
  });
  if (!res.ok) throw new Error(`API error (${res.status}): ${await res.text().catch(() => res.statusText)}`);
  const data = await res.json();
  return extractJson(data.choices?.[0]?.message?.content || '{}');
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
          tools: [{ name: 'record_page', description: 'Records the sentences found in this text.', input_schema: SENTENCE_TOOL_SCHEMA }],
          tool_choice: { type: 'tool', name: 'record_page' },
          messages: [{ role: 'user', content: userText }],
        }),
        signal: AbortSignal.timeout(60000),
      });
      if (!res.ok) throw new Error(`Anthropic API error (${res.status}): ${await res.text().catch(() => res.statusText)}`);
      const data = await res.json();
      return anthropicToolInput(data);
    },
  },
  openai: {
    model: 'gpt-4o-mini',
    call: (apiKey, systemPrompt, userText) =>
      openAiCompatibleTextCall('https://api.openai.com/v1/chat/completions', TEXT_PROVIDERS.openai.model, apiKey, systemPrompt, userText, { strictSchema: true }),
  },
  deepseek: {
    model: 'deepseek-chat',
    // DeepSeek's OpenAI-compatible API supports basic JSON mode (valid JSON
    // syntax guaranteed) but not strict schema enforcement - extractJson()
    // and validateSentences() cover the gap.
    call: (apiKey, systemPrompt, userText) =>
      openAiCompatibleTextCall('https://api.deepseek.com/chat/completions', TEXT_PROVIDERS.deepseek.model, apiKey, systemPrompt, userText, { strictSchema: false }),
  },
};

export const LLM_PROVIDERS = Object.keys(TEXT_PROVIDERS);
export const VISION_CAPABLE_PROVIDERS = Object.keys(VISION_PROVIDERS);

function buildVisionSystemPrompt(chapter) {
  return [
    'You transcribe a photo of a German book page and translate it into Persian, for a bilingual',
    'reading app. Read every sentence on the page in order, correcting for photo/scan artifacts using',
    'context, and translate each sentence into fluent, natural Persian. Call the record_page tool with',
    'the result. If the photo has no readable German text at all, call it with an empty sentences array.',
    chapter ? `The current chapter is: ${chapter}` : null,
  ]
    .filter(Boolean)
    .join('\n');
}

export async function formatPageFromImage({ provider, apiKey, imageBase64, mimeType, chapter }) {
  const impl = VISION_PROVIDERS[provider];
  if (!impl) throw new Error(`"${provider}" doesn't support reading photos (no vision API) - use Anthropic or OpenAI for this.`);
  const systemPrompt = buildVisionSystemPrompt(chapter);
  const result = await impl.call(apiKey, systemPrompt, imageBase64, mimeType);
  return { sentences: validateSentences(result) };
}

function buildTextSystemPrompt(chapter) {
  return [
    'You receive raw German text extracted from one page of a book (via a PDF text layer or OCR, so',
    'it may contain minor extraction artifacts: stray line breaks, hyphenation, or misread characters).',
    'Reconstruct the intended sentences, correcting obvious extraction mistakes using context, and',
    'translate each sentence into fluent, natural Persian.',
    'Respond with ONLY a JSON object of the exact shape {"sentences": [{"de": "...", "fa": "..."}]} -',
    'no commentary, explanation, or markdown fences. If the text has no real content at all, respond',
    'with {"sentences": []}.',
    chapter ? `The current chapter is: ${chapter}` : null,
  ]
    .filter(Boolean)
    .join('\n');
}

export async function formatPageFromText({ provider, apiKey, rawText, chapter }) {
  const impl = TEXT_PROVIDERS[provider];
  if (!impl) throw new Error(`Unsupported AI provider: ${provider}`);
  const systemPrompt = buildTextSystemPrompt(chapter);
  const result = await impl.call(apiKey, systemPrompt, rawText);
  return { sentences: validateSentences(result) };
}
