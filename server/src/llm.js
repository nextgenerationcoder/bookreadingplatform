// Two kinds of AI calls, both using a user's own API key:
//
// - Vision (formatPageFromImage): reads a photo of a page directly - used by
//   the page-photo batch upload in Add Pages. Only vision-capable providers.
// - Text (formatPageFromText): takes already-extracted German text (e.g.
//   from a PDF's text layer) and translates+formats it - used by the whole-
//   book PDF import pipeline. Any text-chat provider, including DeepSeek,
//   which has no vision API at all.
//
// Both return { sentences: [{ de, fa }], separableVerbs: [...] } -
// structured data, not free text the model wrote in a format we then have
// to parse. Earlier this asked the model to write its reply as literal
// "PAGE N / 1: sentence / translation" text and parsed that back apart; it
// didn't reliably comply (especially on short pages - a title page with
// just an author's name, a back-cover blurb), and a page whose reply was
// missing the header line got rejected outright. Now the API itself
// enforces the shape: Anthropic via forced tool use, OpenAI via Structured
// Outputs (json_schema, strict), DeepSeek via JSON mode (its
// OpenAI-compatible API doesn't guarantee a schema, so the parsed result is
// still validated here). buildPageBlock() (in bookImporter.js) then builds
// our PAGE/CHAPTER/"N: sentence" text deterministically from that clean
// data.
//
// separableVerbs (client/src/separableVerbs.js's "trennbares Verb"
// detection - e.g. "trägst ... bei" = beitragen) only recognizes a compound
// once its infinitive is a real dictionary entry, and a conjugated form
// resolves to that infinitive via a " • infinitive" hint on its own
// dictionary entry. Book content built up by hand over many rounds of
// testing has good coverage; freshly-translated text (PDF import, the
// text/paste import) hits brand-new vocabulary every time and had none of
// that - so the same AI call that's already translating the page is also
// asked to report every separable verb it used, which gets upserted into
// the dictionary at import time (see upsertSeparableVerbs below),
// automating what used to be a manual per-word dictionary fix.

const SEPARABLE_VERB_INSTRUCTION =
  'Also list every separable-prefix verb (trennbares Verb) used in the German text, e.g. "trägst ... bei" ' +
  'is a split form of "beitragen" - give its exact conjugated form as it appears, its infinitive, and a ' +
  'concise Persian gloss for the infinitive, in separableVerbs. This lets a reading app that highlights ' +
  'split verbs as one clickable word recognize this one, even though its dictionary has never seen this ' +
  'specific word before.';

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
    separableVerbs: {
      type: 'array',
      description:
        'Every separable-prefix verb (trennbares Verb) used anywhere in the sentences above, e.g. "trägst ... bei" -> beitragen. Empty if none were used.',
      items: {
        type: 'object',
        properties: {
          conjugatedForm: { type: 'string', description: 'The exact inflected form as it appears in the text, e.g. "trägst".' },
          infinitive: { type: 'string', description: 'The separable verb\'s infinitive, e.g. "beitragen".' },
          gloss: { type: 'string', description: 'A concise Persian translation of the infinitive (the separable verb\'s meaning).' },
        },
        required: ['conjugatedForm', 'infinitive', 'gloss'],
      },
    },
  },
  required: ['sentences', 'separableVerbs'],
};

function validateSentences(parsed) {
  if (!parsed || !Array.isArray(parsed.sentences)) {
    throw new Error('AI response was not in the expected {sentences: [...]} shape');
  }
  const sentences = parsed.sentences
    .filter((s) => s && typeof s.de === 'string' && typeof s.fa === 'string' && s.de.trim())
    .map((s) => ({ de: s.de.trim(), fa: s.fa.trim() }));

  const separableVerbs = (Array.isArray(parsed.separableVerbs) ? parsed.separableVerbs : [])
    .filter(
      (v) =>
        v &&
        typeof v.conjugatedForm === 'string' &&
        typeof v.infinitive === 'string' &&
        typeof v.gloss === 'string' &&
        v.conjugatedForm.trim() &&
        v.infinitive.trim() &&
        v.gloss.trim()
    )
    .map((v) => ({ conjugatedForm: v.conjugatedForm.trim(), infinitive: v.infinitive.trim(), gloss: v.gloss.trim() }));

  return { sentences, separableVerbs };
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
          separableVerbs: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                conjugatedForm: { type: 'string' },
                infinitive: { type: 'string' },
                gloss: { type: 'string' },
              },
              required: ['conjugatedForm', 'infinitive', 'gloss'],
              additionalProperties: false,
            },
          },
        },
        required: ['sentences', 'separableVerbs'],
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
    SEPARABLE_VERB_INSTRUCTION,
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
  return validateSentences(result);
}

function buildTextSystemPrompt(chapter) {
  return [
    'You receive raw German text extracted from one page of a book (via a PDF text layer or OCR, so',
    'it may contain minor extraction artifacts: stray line breaks, hyphenation, or misread characters),',
    'or pasted/shared directly from a webpage. Reconstruct the intended sentences, correcting obvious',
    'extraction mistakes using context, and translate each sentence into fluent, natural Persian.',
    'Respond with ONLY a JSON object of the exact shape',
    '{"sentences": [{"de": "...", "fa": "..."}], "separableVerbs": [...]} -',
    'no commentary, explanation, or markdown fences. If the text has no real content at all, respond',
    'with {"sentences": [], "separableVerbs": []}.',
    SEPARABLE_VERB_INSTRUCTION,
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
  return validateSentences(result);
}

// Explains why a wrong LessonPlayer answer is wrong (used by both Courses'
// active-recall lessons and Interview lessons - see LessonPlayer.js's
// onsubmit "wrong" branch). Uses the account's own Translation API key,
// same as formatPageFromText above - a separate schema/provider table
// because the shape is unrelated to page translation, but the same
// per-provider call pattern (Anthropic forced tool use / OpenAI strict
// Structured Outputs / DeepSeek best-effort JSON mode + validation).
//
// Deliberately never asked to reveal the correct answer - the schema has
// no field for it, and the system prompt tells it not to state or imply
// it in the explanation text. errorTags must come from availableTags (the
// real error_tags already used across grammar_lessons - see
// routes/grammar.js), not invented, so the client can reliably resolve
// them back to a real, clickable grammar lesson.
const MISTAKE_TOOL_SCHEMA = {
  type: 'object',
  properties: {
    isGrammarMistake: {
      type: 'boolean',
      description: 'True if the mistake is about German grammar (word order, case, conjugation, article, etc.), false if it is vocabulary, spelling, or something else non-grammatical.',
    },
    errorTags: {
      type: 'array',
      description: 'Zero or more tags, ONLY from the provided list of available tags, that best describe the grammar mistake. Empty if isGrammarMistake is false or no tag fits well.',
      items: { type: 'string' },
    },
    explanation: {
      type: 'string',
      description: 'One or two short sentences explaining why the learner\'s answer is wrong. Never state, spell out, or strongly imply the correct answer - just explain the nature of the mistake.',
    },
  },
  required: ['isGrammarMistake', 'errorTags', 'explanation'],
};

function openAiMistakeJsonSchema() {
  return {
    type: 'json_schema',
    json_schema: {
      name: 'mistake_explanation',
      strict: true,
      schema: {
        type: 'object',
        properties: {
          isGrammarMistake: { type: 'boolean' },
          errorTags: { type: 'array', items: { type: 'string' } },
          explanation: { type: 'string' },
        },
        required: ['isGrammarMistake', 'errorTags', 'explanation'],
        additionalProperties: false,
      },
    },
  };
}

function validateMistakeExplanation(parsed, availableTags) {
  if (!parsed || typeof parsed.explanation !== 'string' || !parsed.explanation.trim()) {
    throw new Error('AI response was not in the expected mistake-explanation shape');
  }
  const tagSet = new Set(availableTags);
  return {
    explanation: parsed.explanation.trim(),
    isGrammarMistake: !!parsed.isGrammarMistake,
    errorTags: Array.isArray(parsed.errorTags) ? parsed.errorTags.filter((tag) => tagSet.has(tag)) : [],
  };
}

const MISTAKE_PROVIDERS = {
  anthropic: {
    model: 'claude-haiku-4-5-20251001',
    async call(apiKey, systemPrompt, userText) {
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
        body: JSON.stringify({
          model: MISTAKE_PROVIDERS.anthropic.model,
          max_tokens: 500,
          system: systemPrompt,
          tools: [{ name: 'explain_mistake', description: 'Records why the learner\'s answer is wrong.', input_schema: MISTAKE_TOOL_SCHEMA }],
          tool_choice: { type: 'tool', name: 'explain_mistake' },
          messages: [{ role: 'user', content: userText }],
        }),
        signal: AbortSignal.timeout(30000),
      });
      if (!res.ok) throw new Error(`Anthropic API error (${res.status}): ${await res.text().catch(() => res.statusText)}`);
      const data = await res.json();
      return anthropicToolInput(data);
    },
  },
  openai: {
    model: 'gpt-4o-mini',
    call: (apiKey, systemPrompt, userText) =>
      openAiCompatibleMistakeCall('https://api.openai.com/v1/chat/completions', MISTAKE_PROVIDERS.openai.model, apiKey, systemPrompt, userText, { strictSchema: true }),
  },
  deepseek: {
    model: 'deepseek-chat',
    call: (apiKey, systemPrompt, userText) =>
      openAiCompatibleMistakeCall('https://api.deepseek.com/chat/completions', MISTAKE_PROVIDERS.deepseek.model, apiKey, systemPrompt, userText, { strictSchema: false }),
  },
};

async function openAiCompatibleMistakeCall(url, model, apiKey, systemPrompt, userText, { strictSchema }) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model,
      response_format: strictSchema ? openAiMistakeJsonSchema() : { type: 'json_object' },
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userText },
      ],
    }),
    signal: AbortSignal.timeout(30000),
  });
  if (!res.ok) throw new Error(`API error (${res.status}): ${await res.text().catch(() => res.statusText)}`);
  const data = await res.json();
  return extractJson(data.choices?.[0]?.message?.content || '{}');
}

export async function explainMistake({ provider, apiKey, promptText, expectedAnswer, userAnswer, promptLang, availableTags }) {
  const impl = MISTAKE_PROVIDERS[provider];
  if (!impl) throw new Error(`Unsupported AI provider: ${provider}`);

  const explanationLanguage = promptLang === 'en' ? 'English' : 'Persian';
  // Explicitly spelled out as a JSON object (not just "call this tool") even
  // though the Anthropic path is forced via tool_choice regardless of
  // phrasing - DeepSeek's OpenAI-compatible json_object response mode
  // requires the word "json" to appear in the prompt at all, or its API
  // rejects the request outright (this bit the AI page-translation prompts
  // too, see buildTextSystemPrompt above, which is why that one spells out
  // "JSON object" explicitly - this prompt originally didn't, which broke
  // every DeepSeek call to this endpoint).
  const systemPrompt = [
    `You help a German learner understand a wrong answer in a language-learning app, without giving away the answer.`,
    `You are given the exercise prompt, the expected German answer (for your own grounding only), and what the`,
    `learner actually typed. Respond with ONLY a JSON object of the exact shape`,
    `{"isGrammarMistake": true/false, "errorTags": ["..."], "explanation": "..."} - no commentary, explanation`,
    `text outside that object, or markdown fences.`,
    `explanation: a short explanation (1-2 sentences, in ${explanationLanguage}) of what's wrong with the`,
    `learner's answer (word order, wrong case, wrong verb form, missing word, wrong vocabulary, spelling, etc).`,
    `CRITICAL: never state, spell out, or closely paraphrase the expected answer itself in explanation - the`,
    `learner must still work it out themselves.`,
    `isGrammarMistake: true only if the mistake is about German grammar, not just vocabulary/spelling.`,
    `errorTags: zero or more tags that best match the mistake, ONLY from this exact list, copying the spelling`,
    `exactly - never invent a tag that isn't in this list: [${availableTags.join(', ')}]. Empty array if none fit`,
    `or isGrammarMistake is false.`,
  ].join(' ');

  const userText = [
    `Exercise prompt: ${promptText}`,
    `Expected answer (do not reveal): ${expectedAnswer}`,
    `Learner's answer: ${userAnswer}`,
  ].join('\n');

  const result = await impl.call(apiKey, systemPrompt, userText);
  return validateMistakeExplanation(result, availableTags);
}
