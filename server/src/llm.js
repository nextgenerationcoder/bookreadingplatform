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
    `explanation: a short, SPECIFIC explanation (1-2 sentences, in ${explanationLanguage}) of what's wrong -`,
    `point to the actual spot in what they wrote (e.g. "the word you used for X" or "the ending on Y"), not a`,
    `vague general category like just "word order" or "wrong case" with nothing else. Write for a complete`,
    `beginner who has never studied linguistics: plain, everyday words only - NEVER technical grammar terms in`,
    `either language (no "ضمیر وجهی", "حالت مفعولی", "modal", "accusative case", "subordinate clause", etc.),`,
    `even if that IS the textbook name for the mistake - describe it the way a friend would explain it out loud,`,
    `not a textbook.`,
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

// Generates a personalized multi-lesson practice course (see
// practiceCourseGenerator.js for how the learner input is built and how the
// result is converted into LessonPlayer steps), using the account's own
// Translation API key. Unlike the other AI calls in this file, this one
// does NOT use a forced tool schema / strict Structured Outputs - the
// course this produces is a deeply nested, variable-length structure (many
// lessons, each with many steps), which doesn't fit a fixed JSON Schema
// well, and the caller's system prompt (the german-course-generator skill)
// already fully specifies the required JSON shape in prose - the same
// "plain JSON in the response text" approach buildTextSystemPrompt already
// uses for DeepSeek works reliably for exactly this kind of case, so it's
// used uniformly here for all three providers rather than mixing schema
// styles. Needs a much larger max_tokens and timeout than the other calls
// here - a real course runs to thousands of tokens of output - and
// DeepSeek's json_object mode requires the word "json" to appear in the
// prompt (see explainMistake's fix above), which the skill text already
// does throughout.
const COURSE_MAX_TOKENS = 8192;
const COURSE_TIMEOUT_MS = 180000;

async function courseProviderCall(provider, apiKey, systemPrompt, userText) {
  if (provider === 'anthropic') {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: COURSE_MAX_TOKENS,
        system: systemPrompt,
        messages: [{ role: 'user', content: userText }],
      }),
      signal: AbortSignal.timeout(COURSE_TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`Anthropic API error (${res.status}): ${await res.text().catch(() => res.statusText)}`);
    const data = await res.json();
    const text = data.content?.find((block) => block.type === 'text')?.text;
    if (!text) throw new Error('Anthropic response had no text content');
    return extractJson(text);
  }

  const impl =
    provider === 'openai'
      ? { url: 'https://api.openai.com/v1/chat/completions', model: 'gpt-4o-mini' }
      : provider === 'deepseek'
        ? { url: 'https://api.deepseek.com/chat/completions', model: 'deepseek-chat' }
        : null;
  if (!impl) throw new Error(`Unsupported AI provider: ${provider}`);

  const res = await fetch(impl.url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: impl.model,
      max_tokens: COURSE_MAX_TOKENS,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userText },
      ],
    }),
    signal: AbortSignal.timeout(COURSE_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`API error (${res.status}): ${await res.text().catch(() => res.statusText)}`);
  const data = await res.json();
  return extractJson(data.choices?.[0]?.message?.content || '{}');
}

// "Link separable verb"'s sibling for multi-word phrases: a learner selects
// a chunk of German text (see reader.js's "Extract pattern (AI)" menu item,
// offered for a multi-word selection) that's really a fixed idiomatic
// construction with one variable slot, e.g. selecting "einen Überblick über
// diese Unternehmenssoftware verschaffen" out of a sentence about one
// specific piece of software - the reusable, dictionary-worthy unit isn't
// that literal sentence fragment but the pattern "einen Überblick über
// etwas verschaffen" (to get an overview of something), with the specific
// object generalized into a placeholder. Doing that generalization
// mechanically would need real German grammar (case government, gender)
// well beyond what's worth hand-coding here, so it's delegated to the same
// AI call already used elsewhere in this file - given the selected phrase
// plus its full sentence and that sentence's Persian translation for
// context, it returns the generalized pattern and a fresh translation of
// the pattern itself (not of the original literal text, which wouldn't
// make sense once the object's been swapped for a placeholder).
const PATTERN_TOOL_SCHEMA = {
  type: 'object',
  properties: {
    pattern: {
      type: 'string',
      description:
        'The reusable German structure generalized from the selected phrase: keep the fixed verb, preposition, and word order exactly as used, but replace any specific noun/name/pronoun that could vary with an appropriate placeholder (etwas for a thing; jemand/jemanden/jemandem/jemandes for a person, inflected for whatever case the construction requires). If the selected phrase is already a fixed idiom with nothing variable in it, return it unchanged.',
    },
    translation: {
      type: 'string',
      description: 'A fluent Persian translation of the generalized pattern itself, not of the original literal text it was extracted from.',
    },
  },
  required: ['pattern', 'translation'],
};

function openAiPatternJsonSchema() {
  return {
    type: 'json_schema',
    json_schema: {
      name: 'phrase_pattern',
      strict: true,
      schema: {
        type: 'object',
        properties: { pattern: { type: 'string' }, translation: { type: 'string' } },
        required: ['pattern', 'translation'],
        additionalProperties: false,
      },
    },
  };
}

function validatePhrasePattern(parsed) {
  if (!parsed || typeof parsed.pattern !== 'string' || !parsed.pattern.trim() || typeof parsed.translation !== 'string' || !parsed.translation.trim()) {
    throw new Error('AI response was not in the expected {pattern, translation} shape');
  }
  return { pattern: parsed.pattern.trim(), translation: parsed.translation.trim() };
}

const PATTERN_PROVIDERS = {
  anthropic: {
    model: 'claude-haiku-4-5-20251001',
    async call(apiKey, systemPrompt, userText) {
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
        body: JSON.stringify({
          model: PATTERN_PROVIDERS.anthropic.model,
          max_tokens: 500,
          system: systemPrompt,
          tools: [{ name: 'record_pattern', description: 'Records the generalized phrase pattern and its translation.', input_schema: PATTERN_TOOL_SCHEMA }],
          tool_choice: { type: 'tool', name: 'record_pattern' },
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
    async call(apiKey, systemPrompt, userText) {
      const res = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({
          model: PATTERN_PROVIDERS.openai.model,
          response_format: openAiPatternJsonSchema(),
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userText },
          ],
        }),
        signal: AbortSignal.timeout(30000),
      });
      if (!res.ok) throw new Error(`OpenAI API error (${res.status}): ${await res.text().catch(() => res.statusText)}`);
      const data = await res.json();
      return JSON.parse(data.choices?.[0]?.message?.content || '{}');
    },
  },
  deepseek: {
    model: 'deepseek-chat',
    async call(apiKey, systemPrompt, userText) {
      const res = await fetch('https://api.deepseek.com/chat/completions', {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({
          model: PATTERN_PROVIDERS.deepseek.model,
          response_format: { type: 'json_object' },
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
    },
  },
};

// Office roleplay game (see server/src/game/) - one AI call per turn, given
// the game's own system prompt (setting/characters/tone, built in
// game/prompt.js) and a short summary of the story so far plus the
// player's last choice. The AI narrates; it never invents numbers (XP,
// boss opinion, etc.) - those live entirely in game_sessions.state_json,
// computed by game/engine.js's pure functions, never by the model. Each
// choice also carries `tags` - the AI's own judgment of how cheeky/risky
// that choice would be, used ONLY as input to engine.js's deterministic
// math; the model never computes or reports an actual numeric effect.
// outcome narrates what happened as a direct result of the player's last
// choice (empty string on the very first turn, where there's no previous
// choice to resolve yet) - the route tells the AI what engine.js already
// computed (see game/prompt.js's describeEffects), so outcome narrates
// exactly that instead of inventing its own version of what happened.
// choices is normally exactly two options; exactly zero once the player
// has just been fired (game/prompt.js's buildTurnPrompt asks for this
// explicitly when it knows the game is over) - no other length is valid.
// summary is a short (1-2 sentence) updated recap of the story so far, to
// feed back in as context on the NEXT turn instead of replaying the whole
// history - keeps the prompt small no matter how long a game session runs.
// words_used self-reports which of the target vocabulary words (see
// game/vocab.js's pickTargetWords) the model believes it wove into this
// turn - routes/game.js verifies each one actually appears in the text
// before recording it as "seen again" (game/vocab.js's verifyWordsUsed),
// since this is the model's own claim, not a guarantee.
const GAME_TURN_CHOICE_TAGS_SCHEMA = {
  type: 'object',
  properties: {
    frech: {
      type: 'integer',
      description: 'How cheeky/mischievous this choice is: 0 (not at all) to 3 (very).',
    },
    chef_sieht: {
      type: 'boolean',
      description: 'Whether Frau Krüger would see or find out about this action.',
    },
    betrifft: {
      type: ['string', 'null'],
      enum: ['krueger', 'jonas', 'lena', 'becker', null],
      description: 'Which fixed character (if any) this choice is mainly directed at or involves.',
    },
    flirt: {
      type: 'boolean',
      description: 'Whether this choice is a flirting action toward Lena.',
    },
    check: {
      type: ['string', 'null'],
      enum: ['easy', 'hard', null],
      description:
        'null for most choices. Set to "easy" or "hard" ONLY for an action that naturally needs skill to pull off well (writing a tricky email, persuading someone, lying convincingly, a phone call with a client) - roughly one choice in three, never every turn. "hard" for a bigger risk/higher stakes version of the same kind of action.',
    },
  },
  required: ['frech', 'chef_sieht', 'betrifft', 'flirt', 'check'],
};

const GAME_TURN_TOOL_SCHEMA = {
  type: 'object',
  properties: {
    outcome: {
      type: 'string',
      description:
        "What happened as a direct result of the player's last choice, in German, narrating exactly the effects described to you - empty string if this is the very first turn of the game (no previous choice to resolve yet).",
    },
    scene: {
      type: 'string',
      description: 'The new scene/situation, in German, short (2-4 sentences, mostly dialogue), as instructed by the system prompt.',
    },
    choices: {
      type: 'array',
      description: 'Exactly two choices the player can make next, in German, each with its own tags - or exactly zero if the player has just been fired.',
      items: {
        type: 'object',
        properties: {
          text: { type: 'string', description: 'The choice text, in German.' },
          tags: GAME_TURN_CHOICE_TAGS_SCHEMA,
        },
        required: ['text', 'tags'],
      },
    },
    summary: {
      type: 'string',
      description: "A short (1-2 sentence) updated recap of the story so far, to carry forward as next turn's context instead of the full history.",
    },
    words_used: {
      type: 'array',
      description:
        'Which of the target words you were given (if any) you actually used in this turn\'s scene/choices - exactly as given to you, not an inflected form. Empty array if you were given no target words, or used none of them.',
      items: { type: 'string' },
    },
  },
  required: ['outcome', 'scene', 'choices', 'summary', 'words_used'],
};

function openAiGameTurnJsonSchema() {
  const tagsSchema = {
    type: 'object',
    properties: {
      frech: { type: 'integer' },
      chef_sieht: { type: 'boolean' },
      betrifft: { type: ['string', 'null'], enum: ['krueger', 'jonas', 'lena', 'becker', null] },
      flirt: { type: 'boolean' },
      check: { type: ['string', 'null'], enum: ['easy', 'hard', null] },
    },
    required: ['frech', 'chef_sieht', 'betrifft', 'flirt', 'check'],
    additionalProperties: false,
  };
  return {
    type: 'json_schema',
    json_schema: {
      name: 'game_turn',
      strict: true,
      schema: {
        type: 'object',
        properties: {
          outcome: { type: 'string' },
          scene: { type: 'string' },
          choices: {
            type: 'array',
            items: {
              type: 'object',
              properties: { text: { type: 'string' }, tags: tagsSchema },
              required: ['text', 'tags'],
              additionalProperties: false,
            },
          },
          summary: { type: 'string' },
          words_used: { type: 'array', items: { type: 'string' } },
        },
        required: ['outcome', 'scene', 'choices', 'summary', 'words_used'],
        additionalProperties: false,
      },
    },
  };
}

const VALID_BETRIFFT = new Set(['krueger', 'jonas', 'lena', 'becker', null]);
const VALID_CHECK = new Set(['easy', 'hard', null]);

function validateChoiceTags(tags) {
  return (
    tags &&
    Number.isInteger(tags.frech) &&
    tags.frech >= 0 &&
    tags.frech <= 3 &&
    typeof tags.chef_sieht === 'boolean' &&
    VALID_BETRIFFT.has(tags.betrifft ?? null) &&
    typeof tags.flirt === 'boolean' &&
    VALID_CHECK.has(tags.check ?? null)
  );
}

// Hard ceiling on the carried-forward story summary - the system prompt
// asks for "a short 1-2 sentence recap" every turn, but nothing stops a
// model from drifting longer over many turns (each turn's summary is
// itself built from the previous one), which would otherwise grow the
// per-turn prompt's token cost turn after turn with no limit. Enforced
// here, not trusted to the model's own compliance, since this is a
// server-side cost/safety concern, not a narration quality one.
const MAX_SUMMARY_CHARS = 600;

function validateGameTurn(parsed) {
  if (
    !parsed ||
    typeof parsed.outcome !== 'string' ||
    typeof parsed.scene !== 'string' ||
    !parsed.scene.trim() ||
    typeof parsed.summary !== 'string' ||
    !parsed.summary.trim() ||
    !Array.isArray(parsed.choices) ||
    (parsed.choices.length !== 2 && parsed.choices.length !== 0) ||
    parsed.choices.some((c) => !c || typeof c.text !== 'string' || !c.text.trim() || !validateChoiceTags(c.tags)) ||
    !Array.isArray(parsed.words_used) ||
    parsed.words_used.some((w) => typeof w !== 'string')
  ) {
    throw new Error('AI response was not in the expected {outcome, scene, choices: [0 or 2x{text,tags}], summary, words_used} shape');
  }
  return {
    outcome: parsed.outcome.trim(),
    scene: parsed.scene.trim(),
    choices: parsed.choices.map((c) => ({
      text: c.text.trim(),
      tags: {
        frech: c.tags.frech,
        chef_sieht: c.tags.chef_sieht,
        betrifft: c.tags.betrifft ?? null,
        flirt: c.tags.flirt,
        check: c.tags.check ?? null,
      },
    })),
    summary: parsed.summary.trim().slice(0, MAX_SUMMARY_CHARS),
    wordsUsed: parsed.words_used.map((w) => w.trim()).filter(Boolean),
  };
}

// Rough published per-1M-token USD rates for each game-turn model, used
// ONLY to log an estimated cost per turn (see logGameTurnUsage below) -
// never shown to the player, never used for billing. Update here if a
// provider changes its pricing materially; being slightly off doesn't
// matter for a log line meant to catch gross cost surprises, not account
// for them to the cent.
const GAME_TURN_PRICING_PER_1M_USD = {
  anthropic: { inputTokens: 1, outputTokens: 5 },
  openai: { inputTokens: 0.15, outputTokens: 0.6 },
  deepseek: { inputTokens: 0.27, outputTokens: 1.1 },
};

function logGameTurnUsage(provider, model, usage) {
  if (!usage) return;
  const { inputTokens = 0, outputTokens = 0 } = usage;
  const pricing = GAME_TURN_PRICING_PER_1M_USD[provider];
  const estCostUsd = pricing ? (inputTokens / 1e6) * pricing.inputTokens + (outputTokens / 1e6) * pricing.outputTokens : null;
  console.log(
    `[game ai usage] provider=${provider} model=${model} inputTokens=${inputTokens} outputTokens=${outputTokens}` +
      (estCostUsd !== null ? ` estCostUsd=${estCostUsd.toFixed(5)}` : ' estCostUsd=unknown')
  );
}

const GAME_TURN_PROVIDERS = {
  anthropic: {
    model: 'claude-haiku-4-5-20251001',
    async call(apiKey, systemPrompt, userText) {
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
        body: JSON.stringify({
          model: GAME_TURN_PROVIDERS.anthropic.model,
          max_tokens: 1200,
          system: systemPrompt,
          tools: [{ name: 'record_turn', description: 'Records this turn of the office roleplay game.', input_schema: GAME_TURN_TOOL_SCHEMA }],
          tool_choice: { type: 'tool', name: 'record_turn' },
          messages: [{ role: 'user', content: userText }],
        }),
        signal: AbortSignal.timeout(45000),
      });
      if (!res.ok) throw new Error(`Anthropic API error (${res.status}): ${await res.text().catch(() => res.statusText)}`);
      const data = await res.json();
      return { input: anthropicToolInput(data), usage: { inputTokens: data.usage?.input_tokens, outputTokens: data.usage?.output_tokens } };
    },
  },
  openai: {
    model: 'gpt-4o-mini',
    async call(apiKey, systemPrompt, userText) {
      const res = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({
          model: GAME_TURN_PROVIDERS.openai.model,
          response_format: openAiGameTurnJsonSchema(),
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userText },
          ],
        }),
        signal: AbortSignal.timeout(45000),
      });
      if (!res.ok) throw new Error(`OpenAI API error (${res.status}): ${await res.text().catch(() => res.statusText)}`);
      const data = await res.json();
      return {
        input: JSON.parse(data.choices?.[0]?.message?.content || '{}'),
        usage: { inputTokens: data.usage?.prompt_tokens, outputTokens: data.usage?.completion_tokens },
      };
    },
  },
  deepseek: {
    model: 'deepseek-chat',
    async call(apiKey, systemPrompt, userText) {
      const res = await fetch('https://api.deepseek.com/chat/completions', {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({
          model: GAME_TURN_PROVIDERS.deepseek.model,
          response_format: { type: 'json_object' },
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userText },
          ],
        }),
        signal: AbortSignal.timeout(45000),
      });
      if (!res.ok) throw new Error(`API error (${res.status}): ${await res.text().catch(() => res.statusText)}`);
      const data = await res.json();
      return {
        input: extractJson(data.choices?.[0]?.message?.content || '{}'),
        usage: { inputTokens: data.usage?.prompt_tokens, outputTokens: data.usage?.completion_tokens },
      };
    },
  },
};

// Retries once on a malformed response (a strict schema makes this rare for
// OpenAI, but Anthropic's forced tool-use and DeepSeek's plain JSON mode
// can still occasionally miss, e.g. the wrong number of choices) - a second
// bad response throws, which the route surfaces as a clear error rather
// than ever handing the client a broken turn.
export async function generateGameTurn({ provider, apiKey, systemPrompt, userText }) {
  const impl = GAME_TURN_PROVIDERS[provider];
  if (!impl) throw new Error(`Unsupported AI provider: ${provider}`);

  try {
    const { input, usage } = await impl.call(apiKey, systemPrompt, userText);
    logGameTurnUsage(provider, impl.model, usage);
    return validateGameTurn(input);
  } catch (err) {
    if (err.message.startsWith('AI response was not in the expected')) {
      const { input, usage } = await impl.call(apiKey, systemPrompt, userText);
      logGameTurnUsage(provider, impl.model, usage);
      return validateGameTurn(input);
    }
    throw err;
  }
}

// Skill checks (see docs/office-game.md / game/skillCheck.js) - generates
// 1 (easy) or 2 (hard) quick exercises for a choice tagged "check", using
// the EXACT SAME raw step shapes practiceCourseGenerator.js's own AI call
// already produces and practiceCourseGenerator.js's convertStep already
// parses ({say, answer, exercise_type} for a typed/scramble exercise,
// {words, exercise_type: "matching"} for a matching one) - this is a
// separate, much smaller/faster call (not the whole-course generator,
// which is far too slow for an in-game ~30-second moment), but it
// deliberately speaks the SAME output contract so the conversion/
// rendering code never has to care which call produced a given step.
const SKILL_CHECK_EXERCISE_SCHEMA = {
  type: 'object',
  properties: {
    exercise_type: {
      type: ['string', 'null'],
      enum: ['translate', 'scramble', 'matching', null],
      description: 'null or "translate" for a typed-translation exercise, "scramble" for reorder-the-words, "matching" for connect-word-to-meaning.',
    },
    say: { type: ['string', 'null'], description: 'For translate/scramble: the Persian prompt. null for matching.' },
    answer: { type: ['string', 'null'], description: 'For translate/scramble: the expected German answer. null for matching.' },
    words: {
      type: ['array', 'null'],
      description: 'For matching: 3-5 {german, translation} pairs. null for translate/scramble.',
      items: {
        type: 'object',
        properties: { german: { type: 'string' }, translation: { type: 'string' } },
        required: ['german', 'translation'],
      },
    },
  },
  required: ['exercise_type', 'say', 'answer', 'words'],
};

function skillCheckSystemPrompt() {
  return [
    'You generate SHORT German-learning exercises for a skill-check moment inside a roleplay game - the player',
    'needs to solve this FAST (about 30 seconds), so keep it simple and quick, not a full lesson.',
    'Each exercise is one of:',
    '- translate: {"exercise_type": "translate", "say": "<Persian prompt>", "answer": "<expected German sentence>", "words": null}',
    '- scramble: same shape, with "exercise_type": "scramble" - the answer should be a sentence the player can',
    '  correctly reconstruct from its own words alone (natural order, no words that change form by position).',
    '- matching: {"exercise_type": "matching", "say": null, "answer": null, "words": [{"german":"...","translation":"..."}, ... 3-5 pairs]}',
    'Base the exercise on the CURRENT SCENE given to you - reuse its own vocabulary/situation where it makes',
    'sense (e.g. if the scene is about writing an email, the exercise can be about email vocabulary), and prefer',
    'the player\'s own target words (given to you) when they fit naturally. Keep it realistic and short - a',
    'translate/scramble answer should be one short sentence (4-8 words), not a whole paragraph.',
    'Respond with ONLY a JSON object of the exact shape {"exercises": [<exercise>, ...]} - the array must have',
    'EXACTLY the requested number of exercises, no commentary, no markdown fences.',
  ].join('\n');
}

function skillCheckUserText({ sceneText, choiceText, targetWords, count }) {
  const lines = [
    `Current scene: ${sceneText}`,
    `The player just chose: "${choiceText}"`,
    `Generate exactly ${count} exercise${count > 1 ? 's' : ''} for this skill check.`,
  ];
  if (targetWords && targetWords.length) {
    lines.push(`Player's target words, prefer these if they fit naturally: ${targetWords.map((w) => `${w.german} (${w.persian})`).join(', ')}`);
  }
  return lines.join('\n');
}

function validateSkillCheckExercises(parsed, count) {
  if (!parsed || !Array.isArray(parsed.exercises) || parsed.exercises.length !== count) {
    throw new Error(`AI response was not in the expected {exercises: [${count}x exercise]} shape`);
  }
  return parsed.exercises;
}

function openAiSkillCheckJsonSchema() {
  const exerciseSchema = {
    type: 'object',
    properties: {
      exercise_type: { type: ['string', 'null'], enum: ['translate', 'scramble', 'matching', null] },
      say: { type: ['string', 'null'] },
      answer: { type: ['string', 'null'] },
      words: {
        type: ['array', 'null'],
        items: {
          type: 'object',
          properties: { german: { type: 'string' }, translation: { type: 'string' } },
          required: ['german', 'translation'],
          additionalProperties: false,
        },
      },
    },
    required: ['exercise_type', 'say', 'answer', 'words'],
    additionalProperties: false,
  };
  return {
    type: 'json_schema',
    json_schema: {
      name: 'skill_check_exercises',
      strict: true,
      schema: {
        type: 'object',
        properties: { exercises: { type: 'array', items: exerciseSchema } },
        required: ['exercises'],
        additionalProperties: false,
      },
    },
  };
}

const SKILL_CHECK_PROVIDERS = {
  anthropic: {
    model: 'claude-haiku-4-5-20251001',
    async call(apiKey, systemPrompt, userText) {
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
        body: JSON.stringify({
          model: SKILL_CHECK_PROVIDERS.anthropic.model,
          max_tokens: 700,
          system: systemPrompt,
          tools: [
            {
              name: 'record_exercises',
              description: 'Records the generated skill-check exercises.',
              input_schema: { type: 'object', properties: { exercises: { type: 'array', items: SKILL_CHECK_EXERCISE_SCHEMA } }, required: ['exercises'] },
            },
          ],
          tool_choice: { type: 'tool', name: 'record_exercises' },
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
    async call(apiKey, systemPrompt, userText) {
      const res = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({
          model: SKILL_CHECK_PROVIDERS.openai.model,
          response_format: openAiSkillCheckJsonSchema(),
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userText },
          ],
        }),
        signal: AbortSignal.timeout(30000),
      });
      if (!res.ok) throw new Error(`OpenAI API error (${res.status}): ${await res.text().catch(() => res.statusText)}`);
      const data = await res.json();
      return JSON.parse(data.choices?.[0]?.message?.content || '{}');
    },
  },
  deepseek: {
    model: 'deepseek-chat',
    async call(apiKey, systemPrompt, userText) {
      const res = await fetch('https://api.deepseek.com/chat/completions', {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({
          model: SKILL_CHECK_PROVIDERS.deepseek.model,
          response_format: { type: 'json_object' },
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
    },
  },
};

export async function generateSkillCheckExercises({ provider, apiKey, sceneText, choiceText, targetWords, count }) {
  const impl = SKILL_CHECK_PROVIDERS[provider];
  if (!impl) throw new Error(`Unsupported AI provider: ${provider}`);

  const systemPrompt = skillCheckSystemPrompt();
  const userText = skillCheckUserText({ sceneText, choiceText, targetWords, count });

  try {
    const result = await impl.call(apiKey, systemPrompt, userText);
    return validateSkillCheckExercises(result, count);
  } catch (err) {
    if (err.message.startsWith('AI response was not in the expected')) {
      const retryResult = await impl.call(apiKey, systemPrompt, userText);
      return validateSkillCheckExercises(retryResult, count);
    }
    throw err;
  }
}

export async function extractPhrasePattern({ provider, apiKey, phrase, sentence, sentenceTranslation }) {
  const impl = PATTERN_PROVIDERS[provider];
  if (!impl) throw new Error(`Unsupported AI provider: ${provider}`);

  const systemPrompt = [
    'A German learner selected a chunk of text out of a sentence in a bilingual reading app, because it looks',
    'like a reusable construction (a fixed verb + preposition + case pattern, an idiom, a collocation) rather',
    'than just a one-off fragment. Generalize it into a reusable pattern and translate that pattern, as',
    'instructed. Respond with ONLY a JSON object of the exact shape {"pattern": "...", "translation": "..."} -',
    'no commentary or markdown fences.',
  ].join(' ');

  const userText = [
    `Selected phrase: ${phrase}`,
    `Full sentence it came from: ${sentence}`,
    sentenceTranslation ? `That sentence's Persian translation (context only): ${sentenceTranslation}` : null,
  ]
    .filter(Boolean)
    .join('\n');

  const result = await impl.call(apiKey, systemPrompt, userText);
  return validatePhrasePattern(result);
}

export async function generatePracticeCourse({ provider, apiKey, systemPrompt, learnerInput }) {
  if (!LLM_PROVIDERS.includes(provider)) throw new Error(`Unsupported AI provider: ${provider}`);
  const userText = JSON.stringify(learnerInput);
  return courseProviderCall(provider, apiKey, systemPrompt, userText);
}

// Plain free-text question -> plain free-text answer - the "/ai ... ---"
// command in a worksheet note (see routes/worksheets.js's /ask-ai) needs
// nothing structured, just a short written answer, so this skips every
// other call in this file's forced-tool-schema/JSON-mode machinery and
// talks to each provider's plain chat endpoint directly.
//
// `context` is optional free text to ground the answer in (e.g. the game's
// current scene - see routes/game.js's /ask-ai) - when omitted, the prompt
// is byte-identical to the original worksheet-only version.
export async function answerQuestion({ provider, apiKey, question, context }) {
  if (!LLM_PROVIDERS.includes(provider)) throw new Error(`Unsupported AI provider: ${provider}`);
  const systemPrompt = context
    ? `You are a helpful assistant answering a short question a learner typed into a note field while playing a German-learning text-based roleplay game. Use the CURRENT SCENE below as context when the question refers to it (e.g. "why is it dem Chef here?", "what does this sentence mean?") - you can also just answer a general question normally if it doesn't relate to the scene. Answer concisely and directly, in the same language the question was asked in.\n\n${context}`
    : 'You are a helpful assistant answering a short question a learner typed into a note field on a German-learning worksheet. Answer concisely and directly, in the same language the question was asked in.';

  if (provider === 'anthropic') {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 800,
        system: systemPrompt,
        messages: [{ role: 'user', content: question }],
      }),
      signal: AbortSignal.timeout(45000),
    });
    if (!res.ok) throw new Error(`Anthropic API error (${res.status}): ${await res.text().catch(() => res.statusText)}`);
    const data = await res.json();
    const text = data.content?.find((block) => block.type === 'text')?.text;
    if (!text) throw new Error('Anthropic response had no text content');
    return text.trim();
  }

  const impl =
    provider === 'openai'
      ? { url: 'https://api.openai.com/v1/chat/completions', model: 'gpt-4o-mini' }
      : provider === 'deepseek'
        ? { url: 'https://api.deepseek.com/chat/completions', model: 'deepseek-chat' }
        : null;
  if (!impl) throw new Error(`Unsupported AI provider: ${provider}`);

  const res = await fetch(impl.url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: impl.model,
      max_tokens: 800,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: question },
      ],
    }),
    signal: AbortSignal.timeout(45000),
  });
  if (!res.ok) throw new Error(`API error (${res.status}): ${await res.text().catch(() => res.statusText)}`);
  const data = await res.json();
  const text = data.choices?.[0]?.message?.content;
  if (!text) throw new Error('AI response had no text content');
  return text.trim();
}

// Context-aware single-word translation - "Ctrl/Cmd+Alt+click a word" in
// clickableGermanText.js, for when the dictionary's standalone gloss is
// wrong for how the word is actually used in this specific sentence (e.g.
// a word with several unrelated meanings, an idiom, a separable verb used
// split). Deliberately NOT routed through answerQuestion: that's meant for
// free-form Q&A replies, which a learner wants to read in full - this needs
// a clean, short Persian gloss usable the same way a dictionary entry is,
// not a sentence of explanation wrapped around it.
export async function translateWordInContext({ provider, apiKey, word, sentence }) {
  if (!LLM_PROVIDERS.includes(provider)) throw new Error(`Unsupported AI provider: ${provider}`);
  const systemPrompt =
    'You translate one German word into Persian, as it is actually used in the given sentence (not just its most ' +
    'common dictionary meaning - pick the sense/idiom that fits this specific context). Respond with ONLY the ' +
    'Persian translation itself - a word or very short phrase, no explanation, no quotes, no punctuation around it.';
  const userText = `Sentence: ${sentence}\nWord to translate (in context): ${word}`;

  if (provider === 'anthropic') {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 100,
        system: systemPrompt,
        messages: [{ role: 'user', content: userText }],
      }),
      signal: AbortSignal.timeout(30000),
    });
    if (!res.ok) throw new Error(`Anthropic API error (${res.status}): ${await res.text().catch(() => res.statusText)}`);
    const data = await res.json();
    const text = data.content?.find((block) => block.type === 'text')?.text;
    if (!text) throw new Error('Anthropic response had no text content');
    return text.trim();
  }

  const impl =
    provider === 'openai'
      ? { url: 'https://api.openai.com/v1/chat/completions', model: 'gpt-4o-mini' }
      : provider === 'deepseek'
        ? { url: 'https://api.deepseek.com/chat/completions', model: 'deepseek-chat' }
        : null;
  if (!impl) throw new Error(`Unsupported AI provider: ${provider}`);

  const res = await fetch(impl.url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: impl.model,
      max_tokens: 100,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userText },
      ],
    }),
    signal: AbortSignal.timeout(30000),
  });
  if (!res.ok) throw new Error(`API error (${res.status}): ${await res.text().catch(() => res.statusText)}`);
  const data = await res.json();
  const text = data.choices?.[0]?.message?.content;
  if (!text) throw new Error('AI response had no text content');
  return text.trim();
}

// The reverse of translateWordInContext: a learner clicked a Persian word
// in a bilingual worksheet/course page that has no pre-made German link
// (some curated content only links the words/phrases the curator was
// confident about - see server/content-courses/sprechen-b1-teil1's
// REVIEW_FIRST10_FA.md - everything else is plain, unlinked Persian text).
// Rather than hand-fixing every such gap one at a time, this asks the AI,
// given BOTH sentences, which German substring the clicked Persian word
// corresponds to - returned verbatim so the caller can find and highlight
// that exact text in the German sentence, not just show it in a popup.
export async function findGermanForPersian({ provider, apiKey, persianPhrase, germanSentence, persianSentence }) {
  if (!LLM_PROVIDERS.includes(provider)) throw new Error(`Unsupported AI provider: ${provider}`);
  const systemPrompt =
    'You are given a German sentence, its Persian translation, and one Persian word or short phrase taken from ' +
    'that Persian sentence. Respond with ONLY the exact substring of the German sentence that means the same ' +
    "thing as the given Persian word/phrase - copied character-for-character from the German sentence (same " +
    'spelling, same capitalization, no translation of your own), nothing else: no quotes, no explanation, no ' +
    "added punctuation. If the Persian word/phrase doesn't correspond to any specific substring of the German " +
    'sentence (e.g. it\'s just sentence structure with nothing to point at), respond with exactly: NONE';
  const userText =
    `German sentence: ${germanSentence}\nPersian translation: ${persianSentence}\n` +
    `Persian word/phrase to match: ${persianPhrase}`;

  if (provider === 'anthropic') {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 100,
        system: systemPrompt,
        messages: [{ role: 'user', content: userText }],
      }),
      signal: AbortSignal.timeout(30000),
    });
    if (!res.ok) throw new Error(`Anthropic API error (${res.status}): ${await res.text().catch(() => res.statusText)}`);
    const data = await res.json();
    const text = data.content?.find((block) => block.type === 'text')?.text;
    if (!text) throw new Error('Anthropic response had no text content');
    return text.trim();
  }

  const impl =
    provider === 'openai'
      ? { url: 'https://api.openai.com/v1/chat/completions', model: 'gpt-4o-mini' }
      : provider === 'deepseek'
        ? { url: 'https://api.deepseek.com/chat/completions', model: 'deepseek-chat' }
        : null;
  if (!impl) throw new Error(`Unsupported AI provider: ${provider}`);

  const res = await fetch(impl.url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: impl.model,
      max_tokens: 100,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userText },
      ],
    }),
    signal: AbortSignal.timeout(30000),
  });
  if (!res.ok) throw new Error(`API error (${res.status}): ${await res.text().catch(() => res.statusText)}`);
  const data = await res.json();
  const text = data.choices?.[0]?.message?.content;
  if (!text) throw new Error('AI response had no text content');
  return text.trim();
}
