---
name: german-course-generator
description: >
  Generate a cumulative German practice course from a learner's known vocabulary,
  learning vocabulary, word-frequency ranks, and ranked grammar targets. The course
  must teach through active recall, controlled sentence building, cumulative reuse,
  and gradual difficulty increase. Output machine-readable course JSON suitable for
  a lesson player using WORD / NOTE / SAY / ANSWER style steps.
---

# German Course Generator

## Purpose

Create a structured German practice course for one learner using:

1. words the learner already knows,
2. words the learner is currently learning,
3. a frequency rank for each word,
4. grammar targets from A1 to C1,
5. an importance rank for each grammar target.

The course must not be a vocabulary dump or a grammar summary.

It must make the learner **produce German sentences** by starting with simple known structures and gradually adding new vocabulary and grammar until the learner can build more complex sentences independently.

The core method is:

**known material → one new element → active recall → expansion → combination → transfer → later review**

---

# Inputs

The generator may receive the learner data as JSON, CSV, Markdown, spreadsheet rows, or plain text.

Normalize the data internally into the following conceptual structure.

## Vocabulary

Each word should ideally contain:

```json
{
  "german": "bringen",
  "translation": "to bring",
  "frequency_rank": 412,
  "status": "learning"
}
```

Valid `status` values:

- `known`
- `learning`

Optional fields may include:

```json
{
  "lemma": "bringen",
  "part_of_speech": "verb",
  "cefr": "A1",
  "notes": "irregular",
  "forms": ["bringt", "brachte", "gebracht"]
}
```

Do not require optional fields.

## Grammar

Each grammar item should ideally contain:

```json
{
  "id": "modal-verbs-present",
  "name": "Modal verbs in the present tense",
  "cefr": "A1",
  "importance_rank": 12,
  "status": "practicing"
}
```

Possible status values:

- `known`
- `practicing`
- `learning`
- `review`

If status is missing, treat the supplied grammar list as eligible practice material.

## Optional course settings

The input may also include:

```json
{
  "course_id": "german-practice-course",
  "title": "German Practice Course",
  "prompt_lang": "en",
  "target_language": "de",
  "learner_native_language": "fa",
  "lesson_count": 20,
  "max_new_words_per_lesson": 6,
  "max_primary_grammar_targets_per_lesson": 1,
  "steps_per_lesson": 18
}
```

Defaults:

- `prompt_lang`: `en`
- `target_language`: `de`
- `lesson_count`: determine from available material
- `max_new_words_per_lesson`: 4–6
- `max_primary_grammar_targets_per_lesson`: 1
- `steps_per_lesson`: 14–22

If the learner's website only supports English prompts, keep all `SAY`, `NOTE`, and translation text in English.

---

# Main Course Design Principles

## 1. Known vocabulary is scaffolding

Use `known` words to build the sentence frame.

Known words should carry the lesson so that the learner's attention can focus on the current new word or grammar target.

A practice sentence should normally contain:

- mostly known words,
- at most one or two newly introduced content words,
- the grammar currently being practiced.

Do not make a sentence difficult merely by adding many unfamiliar nouns.

---

## 2. Learning vocabulary is introduced before it is tested

Never expect the learner to produce a learning word before it has been introduced in a `WORD` line.

Bad:

```json
{
  "say": "I need the document.",
  "answer": "Ich brauche das Dokument."
}
```

if `brauchen` and `Dokument` have never been introduced.

Better:

1. introduce `brauchen`,
2. practice it with known words,
3. introduce `das Dokument`,
4. combine them.

---

## 3. Prefer high-frequency learning words

For words marked `learning`, lower numerical frequency rank means higher priority unless the input defines ranking differently.

Prefer high-frequency words early, but do not blindly sort by frequency.

A word can be delayed if:

- it requires grammar not yet introduced,
- it is difficult to use naturally with the learner's known vocabulary,
- another word creates a better learning sequence,
- too many words from the same semantic category would make a lesson repetitive.

Use frequency as a strong priority signal, not the only signal.

---

## 4. Prefer important grammar, but respect prerequisites

Lower numerical `importance_rank` means higher priority unless the input defines ranking differently.

Grammar should follow a dependency-aware progression.

Do not practice a complex structure before the learner has the necessary simpler structure.

Examples:

- basic main-clause word order before inversion,
- present-tense modal verbs before complex modal subordinate clauses,
- main clauses before `weil` / `dass` subordinate clauses,
- simple relative clauses before nested relative clauses,
- basic Perfekt before complex past-time narration,
- basic adjective use before advanced adjective declension combinations.

CEFR level is a guide, not the sole ordering rule.

Within the learner's current range, prioritize:

1. prerequisites,
2. importance rank,
3. usefulness for available vocabulary,
4. frequency of real-world use.

---

# Course Planning

Before generating lessons, create an internal plan.

Do not expose this internal planning unless explicitly requested.

For each lesson choose:

- one primary grammar target,
- optionally one small secondary grammar feature that is already familiar,
- 4–6 learning words,
- 8–20 known words for scaffolding and review.

Avoid introducing two unrelated major grammar systems in the same lesson.

---

# Difficulty Ratio

Aim for approximately:

- 75–90% familiar material,
- 10–25% new material.

A learner should usually understand the sentence frame before being asked to produce the new feature.

If a step introduces new grammar, keep the vocabulary easy.

If a step introduces a new word, keep the grammar familiar.

Avoid simultaneous novelty unless the combination is necessary and very small.

---

# Lesson Architecture

Each lesson should behave like a miniature progression.

Use the following phases when appropriate.

## Phase A — Vocabulary activation

Introduce a new word or phrase.

Example:

```text
WORD: brauchen = to need
```

A vocabulary-only step is allowed.

Then quickly require active use.

---

## Phase B — Minimal sentence

Use the smallest useful structure.

Example:

```text
SAY: I need it.
ANSWER: Ich brauche es.
```

Do not start with an unnecessarily long sentence.

---

## Phase C — Controlled expansion

Add one element at a time.

Example progression:

```text
Ich brauche es.
Ich brauche es heute.
Ich brauche es heute nicht.
Ich kann es heute nicht brauchen.
```

Only use a progression if every intermediate sentence is natural German.

Do not create unnatural sentences merely to preserve a mechanical sequence.

---

## Phase D — Grammar transformation

Transform a known sentence using the target grammar.

Example:

```text
Ich habe es.
Haben Sie es?
Warum haben Sie es nicht?
```

Or:

```text
Ich bin müde.
Ich bleibe zu Hause, weil ich müde bin.
```

A grammar note should appear exactly when the transformation becomes necessary.

---

## Phase E — Combination

Combine structures that were already practiced separately.

Example:

```text
Ich kann es Ihnen heute nicht bringen.
Ich habe es nicht.
```

becomes:

```text
Ich kann es Ihnen heute nicht bringen, denn ich habe es nicht.
```

Do not ask the learner to combine components they have not practiced.

---

## Phase F — Transfer

Change vocabulary while keeping the same grammar.

This proves the learner learned the structure rather than memorizing one sentence.

Example:

```text
SAY: I can bring the book tomorrow.
ANSWER: Ich kann das Buch morgen bringen.
```

Use mostly known words in transfer exercises.

---

## Phase G — Reduced support

Later in the lesson, use fewer `WORD` hints for vocabulary that has already appeared.

Do not repeat the same vocabulary definition on every step.

The learner should increasingly retrieve it from memory.

---

## Phase H — Mixed review

End with 2–4 steps that mix:

- current grammar,
- current learning words,
- selected material from earlier lessons.

The final steps should be harder than the first steps but still use only taught material.

---

# Sentence-Building Method

When creating a complex target sentence, reverse-engineer it internally.

Example target:

```text
Ich kann es Ihnen heute nicht bringen, weil ich sehr beschäftigt bin.
```

Possible teaching path:

```text
Ich bringe es.
Ich bringe es Ihnen.
Ich kann es Ihnen bringen.
Ich kann es Ihnen heute nicht bringen.
Ich bin beschäftigt.
Ich bin sehr beschäftigt.
weil ich sehr beschäftigt bin
Ich kann es Ihnen heute nicht bringen, weil ich sehr beschäftigt bin.
```

The learner should experience the complex sentence as the combination of smaller mastered pieces.

Do not expose a long target sentence before its essential pieces have been introduced.

---

# Vocabulary Selection Rules

## Known words

Use known words freely, but avoid obscure senses or idioms not implied by the learner's data.

A known lemma does not automatically mean every advanced collocation or idiomatic meaning is known.

Prefer ordinary, literal, high-frequency uses.

## Learning words

A learning word should normally appear:

- once in a vocabulary introduction,
- at least 2–4 times in production during its first lesson,
- again in later lessons.

Do not mark a word as learned after one appearance.

## Function words

Very basic function words may be used when unavoidable, but if they are likely to be unknown or grammatically important, introduce them.

Examples:

- weil
- dass
- denn
- obwohl
- während
- deshalb
- trotzdem

Do not smuggle important grammar through unexplained function words.

---

# Spaced Recycling

Recycle learning words and grammar across later lessons.

Preferred review pattern when course length allows:

- first introduction: lesson N,
- quick reuse: lesson N+1,
- delayed reuse: lesson N+3,
- later reuse: lesson N+6 or N+7.

Do not force the exact interval if the course is shorter.

Grammar targets should also recur in later mixed steps.

A lesson should contain roughly:

- 60–75% current lesson material,
- 25–40% older review material.

For early lessons, the review percentage may be smaller because there is little previous material.

---

# Frequency-Aware Word Priority

If frequency ranks are numeric and lower means more frequent, an internal priority score may consider:

```text
priority =
  frequency usefulness
  + grammar compatibility
  + review need
  + semantic usefulness
  - novelty overload
```

Do not expose numeric scores unless requested.

Important behavior:

- a rank-100 word should normally be practiced before a rank-5000 word,
- but a rank-5000 word may appear earlier if it is required by the user's stated goal or grammar context,
- words already overdue for review can temporarily outrank new words.

---

# Grammar Priority

When multiple grammar items are eligible, choose using this order:

1. prerequisite readiness,
2. learner status (`practicing` before untouched advanced material),
3. importance rank,
4. CEFR appropriateness,
5. compatibility with selected vocabulary,
6. opportunity for natural sentence production.

Do not generate a C1 grammar-heavy lesson just because its importance rank is high if the necessary A2/B1 prerequisites are absent.

---

# Grammar Notes

Use `NOTE` sparingly.

A note should:

- explain one practical rule,
- be short,
- use `PROMPT_LANG`,
- directly support the current step.

Good:

```text
NOTE: With a modal verb, the second verb goes to the end in the infinitive.
```

Bad:

```text
NOTE: German modal verbs belong to a historically complex class of preterite-present verbs...
```

Do not repeat the same note in every step.

---

# Natural German Requirement

Every `ANSWER` must be natural, standard German.

Do not preserve bad source word order merely because an input example contains it.

If learner data contains an incorrect or unnatural example:

1. keep the vocabulary or grammar target,
2. silently generate a correct natural practice sentence,
3. only report the correction if the user asks for source comparison.

Use standard capitalization and punctuation.

Examples:

- nouns are capitalized,
- `Sie` formal pronoun is capitalized,
- questions use `?`,
- complete statements use `.`.

---

# Prompt Language Consistency

If `prompt_lang` is `en`:

- `SAY` must be English,
- `NOTE` must be English,
- the translation half of every `WORD` must be English.

Never mix Persian translations into an English-prompt lesson.

The learner's native language may still be supplied as metadata for future use, but output language must obey `prompt_lang`.

---

# Step Types

Internally, each step is one of two types.

## Vocabulary-only step

Contains `words`, but no `say` or `answer`.

Example:

```json
{
  "words": [
    {
      "german": "brauchen",
      "translation": "to need"
    }
  ]
}
```

## Practice step

Contains `say` and `answer`, with optional `note` and optional `words`.

Example:

```json
{
  "words": [
    {
      "german": "brauchen",
      "translation": "to need"
    }
  ],
  "say": "I need it.",
  "answer": "Ich brauche es."
}
```

Never provide `say` without `answer`, or `answer` without `say`.

---

# Required Course JSON Output

Unless the user requests another format, output one JSON object.

Do not wrap the JSON in Markdown fences if the output is intended for direct import.

Use this structure:

```json
{
  "course_id": "german-practice-course",
  "title": "German Practice Course",
  "prompt_lang": "en",
  "target_language": "de",
  "learner_native_language": "fa",
  "lessons": [
    {
      "lesson_id": "lesson-1",
      "title": "Lesson 1 – Haben and Basic Questions",
      "cefr_focus": ["A1"],
      "targets": {
        "grammar": [
          {
            "id": "present-haben",
            "name": "Present tense of haben"
          }
        ],
        "learning_words": [
          "haben",
          "warum",
          "bringen"
        ],
        "review_words": [
          "ich",
          "Sie",
          "heute"
        ]
      },
      "steps": [
        {
          "words": [
            {
              "german": "haben",
              "translation": "to have"
            }
          ]
        },
        {
          "say": "We have it.",
          "answer": "Wir haben es."
        },
        {
          "words": [
            {
              "german": "warum",
              "translation": "why"
            }
          ],
          "note": "With a question word such as \"warum\", the conjugated verb comes before the subject.",
          "say": "Why don't you have it?",
          "answer": "Warum haben Sie es nicht?"
        }
      ]
    }
  ]
}
```

JSON must be valid:

- double-quoted keys,
- double-quoted strings,
- no trailing commas,
- no comments,
- no Markdown fences when direct import is requested.

---

# Optional Legacy Lesson Rendering

If the user asks for the older text lesson format, render a lesson as:

```text
LESSON: lesson-id
TITLE: Lesson Title
PROMPT_LANG: en

### STEP
WORD: brauchen = to need
SAY: I need it.
ANSWER: Ich brauche es.

### STEP
WORD: warum = why
NOTE: With "warum", the question word comes first, followed by the conjugated verb.
SAY: Why don't you need it?
ANSWER: Warum brauchen Sie es nicht?
```

Rules:

- `LESSON:` must be the first line.
- Every step begins exactly with `### STEP`.
- Do not add Markdown code fences around importable output.
- `WORD:` may repeat within a step.
- `NOTE:` is optional.
- `SAY:` and `ANSWER:` must appear together or both be absent.
- Never mix prompt languages.

---

# Course-Level Progression

A course should not feel like isolated lessons.

Each lesson should depend partly on previous lessons.

Example progression:

Lesson 1:
- simple statements
- high-frequency verbs
- basic objects

Lesson 2:
- yes/no questions
- question words
- negation

Lesson 3:
- modal verbs
- infinitive at sentence end

Lesson 4:
- time expressions
- inversion / verb-second behavior

Lesson 5:
- `denn` and simple clause combination

Lesson 6:
- `weil` and subordinate-clause word order

This is only an example.

Actual sequencing must be derived from the supplied grammar ranks, prerequisites, and learner vocabulary.

---

# Avoiding Redundancy

Do not create a separate step for every tiny variation if it has no learning value.

Bad repetition:

```text
Ich habe es.
Wir haben es.
Sie haben es.
Er hat es.
Sie hat es.
Es hat es.
```

unless conjugation itself is the target.

Instead, choose variations that practice a useful contrast.

Example:

```text
Ich habe es.
Haben Sie es?
Warum haben Sie es nicht?
```

Every step should have a learning purpose.

---

# Practice Diversity

Across a lesson, vary the practice operation.

Possible operations:

- translate a short statement,
- make a yes/no question,
- make a W-question,
- negate a sentence,
- add time,
- add place,
- add a modal verb,
- change person,
- combine two clauses,
- convert a main clause into a subordinate clause,
- transfer the structure to new known vocabulary.

Do not use only one operation throughout an entire lesson.

---

# Learner Production First

The learner should produce German.

`SAY` should normally be a meaning prompt, not a German fill-in-the-blank.

Preferred:

```text
SAY: I cannot bring it today.
ANSWER: Ich kann es heute nicht bringen.
```

Use fill-in-the-blank only if the user explicitly requests that exercise type.

---

# Handling Forms and Inflection

The course may use inflected forms even if only the lemma is in the word list.

Examples:

- `haben` → `habe`, `haben`, `hat`
- `bringen` → `bringe`, `bringt`, `gebracht`

But only use inflection that is appropriate for grammar already known or currently taught.

Do not introduce a difficult tense merely to use a learning verb.

---

# New Word Budget

Default per lesson:

- 4–6 new lexical items,
- 1–2 new function words or grammar markers,
- 1 primary grammar target.

For very early A1 material, 3–5 new words may be better.

For advanced learners, lessons may contain more lexical items if the grammar is already familiar.

---

# Lesson Length

Default:

- 14–22 steps per lesson.

A lesson may be shorter if the target is narrow.

A lesson may be longer if it includes multiple tightly connected practice phases.

Do not inflate the step count through meaningless repetition.

---

# Validation Before Output

Before returning the course, verify every lesson.

## Vocabulary validation

- Every learning word is introduced before first required production.
- No unexpected low-frequency content word appears without a reason.
- Known words are used as scaffolding.
- New words recur multiple times.

## Grammar validation

- The main grammar target is actually practiced.
- Prerequisites are available.
- Grammar complexity rises gradually.
- Notes appear only when needed.

## Sentence validation

- Every German answer is natural.
- Capitalization is correct.
- Word order is correct.
- Cases and prepositions are correct.
- English prompts match the German meaning closely.

## Course validation

- Earlier material is recycled.
- Lessons do not become isolated topic lists.
- High-priority vocabulary receives more practice.
- High-priority grammar receives more practice.
- Review is distributed across later lessons.
- Difficulty increases progressively.

## JSON validation

- valid JSON,
- no comments,
- no trailing commas,
- no Markdown code fences if direct import is requested.

---

# Missing or Ambiguous Input

If enough information exists to build a useful course, proceed without asking unnecessary questions.

Use defaults for missing optional settings.

Ask a clarifying question only if a missing detail would materially change the course, for example:

- frequency rank direction is unknown and cannot be inferred,
- known vs learning status is not distinguishable,
- grammar importance ordering is ambiguous,
- the requested output schema is incompatible with the supplied website format.

Do not ask about cosmetic preferences that can safely use defaults.

---

# Recommended Input Shape

When possible, encourage the caller to provide:

```json
{
  "known_words": [
    {
      "german": "ich",
      "translation": "I",
      "frequency_rank": 5
    },
    {
      "german": "heute",
      "translation": "today",
      "frequency_rank": 150
    }
  ],
  "learning_words": [
    {
      "german": "brauchen",
      "translation": "to need",
      "frequency_rank": 320
    },
    {
      "german": "bringen",
      "translation": "to bring",
      "frequency_rank": 410
    }
  ],
  "grammar": [
    {
      "id": "modal-verbs",
      "name": "Modal verbs in main clauses",
      "cefr": "A1",
      "importance_rank": 5,
      "status": "practicing"
    },
    {
      "id": "weil-subordinate-clause",
      "name": "weil subordinate clauses",
      "cefr": "A2",
      "importance_rank": 18,
      "status": "learning"
    }
  ],
  "settings": {
    "course_id": "my-german-course",
    "title": "My German Practice Course",
    "prompt_lang": "en",
    "lesson_count": 12,
    "steps_per_lesson": 18
  }
}
```

---

# Final Objective

The generated course should make the learner gradually able to create German sentences independently.

Do not optimize for the number of vocabulary items covered.

Optimize for:

1. retrieval,
2. reuse,
3. grammatical control,
4. cumulative sentence building,
5. transfer to new sentences,
6. long-term retention.

The learner should finish a lesson able to produce structures they could not reliably produce before the lesson.
