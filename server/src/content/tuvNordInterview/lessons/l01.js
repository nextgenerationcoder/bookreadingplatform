// Lesson 1 — "Sag die Antwort zuerst, dann den Beleg" — transcribed from the
// lesson content and STEP definitions provided for this course. Structured
// data only; the player (client/src/views/learning/lessonPlayer.js) renders
// it generically by step `type` - nothing here is hardcoded into a component.
//
// Field notes:
// - `teaches`: a brand-new element being introduced this step - always
//   shown (spec rule: introduce singly, one new thing per step).
// - `model` / `frame` / `wordBank`: scaffolding aids for producing the
//   target frame - shown/hidden per the step's scaffoldLevel (see
//   learningEngine/scaffold.js). Not shown just because they're present.
// - `productions`: the individual items the learner must attempt before
//   Continue unlocks. No automatic linguistic grading exists (spec/prompt
//   are explicit about this), so "attempted" = recorded audio, or typed
//   text, or (fallback) an explicit self-confirmation - never inferred.

export const l01 = {
  id: 'l01',
  phase: 1,
  title: 'Sag die Antwort zuerst, dann den Beleg',
  goal: 'The learner can answer an experience question with: Kernaussage → Beleg',
  targetMoves: ['M01', 'M02', 'M04'],
  prerequisites: [],
  scaffoldStart: 'S3',
  scaffoldEnd: 'S2',
  personalizationLevel: 'P1',

  steps: [
    {
      id: 'l01-s01',
      type: 'model_repeat',
      instruction: 'Say it aloud, then repeat without looking.',
      scaffoldLevel: 'S3',
      model: 'Bei meinem letzten Projekt habe ich KI-Antworten getestet.',
      productions: [
        { prompt: 'Bei meinem letzten Projekt habe ich KI-Antworten getestet.' },
        { prompt: 'Bei meinem letzten Projekt habe ich KI-Antworten getestet.', note: 'This time, without looking.' },
      ],
    },
    {
      id: 'l01-s02',
      type: 'substitution',
      instruction: 'Say both versions back to back. Only the end changed.',
      scaffoldLevel: 'S3',
      frame: 'Bei meinem letzten Projekt habe ich …',
      productions: [
        { prompt: 'Bei meinem letzten Projekt habe ich KI-Antworten getestet.' },
        { prompt: 'Bei meinem letzten Projekt habe ich ein Teilprojekt geleitet.' },
      ],
    },
    {
      id: 'l01-s03',
      type: 'substitution',
      instruction: 'Say all three in a row, without looking.',
      scaffoldLevel: 'S3',
      frame: 'Bei meinem letzten Projekt habe ich …',
      productions: [
        { prompt: 'Bei meinem letzten Projekt habe ich KI-Antworten getestet.' },
        { prompt: 'Bei meinem letzten Projekt habe ich ein Teilprojekt geleitet.' },
        { prompt: 'Bei meinem letzten Projekt habe ich ein Team geführt.' },
      ],
    },
    {
      id: 'l01-s04',
      type: 'frame_builder',
      instruction: 'Build three sentences, each with a different front and a different ending. Say them aloud.',
      scaffoldLevel: 'S3',
      wordBank: ['bei meinem letzten Projekt', 'bei einem Uni-Projekt', 'bei meiner letzten Stelle'],
      actionBank: ['KI-Antworten getestet', 'ein Teilprojekt geleitet', 'ein Team geführt'],
      productions: [
        { prompt: 'Combination 1 (different project + different action)' },
        { prompt: 'Combination 2 (different project + different action)' },
        { prompt: 'Combination 3 (different project + different action)' },
      ],
    },
    {
      id: 'l01-s05',
      type: 'single_introduction',
      instruction: 'Say two versions with two different words from the bank.',
      scaffoldLevel: 'S3',
      teaches: 'Für mich ist vor allem Struktur wichtig.',
      wordBank: ['Struktur', 'Zuverlässigkeit', 'klare Kommunikation', 'Qualität', 'Nachvollziehbarkeit', 'praktischer Nutzen'],
      productions: [
        { prompt: 'Für mich ist vor allem <word 1> wichtig.' },
        { prompt: 'Für mich ist vor allem <word 2> wichtig.' },
      ],
    },
    {
      id: 'l01-s06',
      type: 'incremental_expansion',
      instruction: 'Build two of your own. Claim first, evidence second. Two sentences, no more.',
      scaffoldLevel: 'S3',
      frame: 'Für mich ist vor allem <X> wichtig. Bei <Projekt> habe ich <Handlung>.',
      model: 'Für mich ist vor allem Zuverlässigkeit wichtig. Bei meinem letzten Projekt habe ich KI-Antworten getestet.',
      seededModel: {
        text: 'Für mich ist vor allem klare Kommunikation wichtig. Bei einem Uni-Projekt habe ich ein Teilprojekt geleitet. Deshalb passt das gut.',
        seeded: true,
        note: 'The last sentence ("Deshalb passt das gut.") is shown once, unanalyzed. You are not asked to produce it yet.',
      },
      productions: [
        { prompt: 'Your own claim + evidence, sentence 1 (no relevance tail)' },
        { prompt: 'Your own claim + evidence, sentence 2 (no relevance tail)' },
      ],
    },
    {
      id: 'l01-s07',
      type: 'drill',
      instruction: 'Say all four aloud, back to back, without stopping.',
      scaffoldLevel: 'S3',
      productions: [
        { prompt: 'Für mich ist vor allem Qualität wichtig. Bei meiner letzten Stelle habe ich ein Team geführt.' },
        { prompt: 'Für mich ist vor allem Struktur wichtig. Bei einem Uni-Projekt habe ich ein Teilprojekt geleitet.' },
        { prompt: 'Für mich ist vor allem Nachvollziehbarkeit wichtig. Bei meinem letzten Projekt habe ich KI-Antworten getestet.' },
        { prompt: '(your own version)' },
      ],
    },
    {
      id: 'l01-s08',
      type: 'structural_substitution',
      instruction: 'Take your favourite sentence from Step 7 and say it both ways.',
      scaffoldLevel: 'S2',
      frame: 'Bei meinem letzten Projekt habe ich … ↔ In meinem letzten Projekt habe ich …',
      productions: [
        { prompt: 'Your sentence, with "Bei …"' },
        { prompt: 'The same sentence, with "In meinem …"' },
      ],
    },
    {
      id: 'l01-s09',
      type: 'survival_chunk',
      instruction: 'Read the question aloud, say the chunk, pause two seconds, then answer with your frame.',
      scaffoldLevel: 'S1',
      teaches: 'Darf ich kurz nachdenken?',
      question: 'Welche Erfahrung haben Sie mit Projektarbeit?',
      productions: [{ prompt: 'Darf ich kurz nachdenken? … (2s) … [your F01 answer]' }],
    },
    {
      id: 'l01-s10',
      type: 'survival_chunk',
      instruction: 'Say it once. Then say it again slower — this one has to come out smoothly, not as a struggle.',
      scaffoldLevel: 'S1',
      teaches: 'Können Sie die Frage bitte noch einmal anders formulieren?',
      productions: [
        { prompt: 'Können Sie die Frage bitte noch einmal anders formulieren?' },
        { prompt: 'Können Sie die Frage bitte noch einmal anders formulieren?', note: 'Slower this time.' },
      ],
    },
    {
      id: 'l01-s11',
      type: 'survival_chunk',
      instruction: 'Deliberately start a sentence, break it off after three words, say the chunk, and start again cleanly.',
      scaffoldLevel: 'S1',
      teaches: 'Ich formuliere das noch einmal:',
      productions: [{ prompt: 'Start a sentence → break off → "Ich formuliere das noch einmal:" → restart cleanly' }],
    },
    {
      id: 'l01-s12',
      type: 'survival_chunk',
      instruction: 'Use it once with a word you actually don’t know in German yet.',
      scaffoldLevel: 'S1',
      teaches: 'Wie heißt das auf Deutsch … ?',
      productions: [{ prompt: 'Wie heißt das auf Deutsch … ?' }],
    },
    {
      id: 'l01-s13',
      type: 'free_production',
      instruction: 'Answer each aloud, in exactly two sentences. Use one survival chunk in at least one of them.',
      scaffoldLevel: 'S2',
      frame: 'Für mich ist vor allem ______ wichtig. Bei ______ habe ich ______.',
      productions: [
        { prompt: 'Haben Sie Erfahrung mit Projektarbeit?' },
        { prompt: 'Haben Sie Erfahrung mit KI-Anwendungen?' },
        { prompt: 'Haben Sie Erfahrung mit Teamarbeit?' },
      ],
      allowTextTranscript: true,
      minSurvivalChunkUses: 1,
    },
  ],

  exitCheck: {
    instructions: 'Spoken, no notes, no preparation. Record yourself or say it to the wall.',
    targetSecondsPerPrompt: 15,
    selfRatingOptions: ['Geschafft', 'Mit Hilfe geschafft', 'Noch schwierig'],
    prompts: [
      {
        id: 'ec1',
        question: 'Haben Sie Erfahrung mit Dokumentation?',
        passCriterion: 'Claim first, then one true "Bei … habe ich …" evidence clause.',
      },
      {
        id: 'ec2',
        question: 'Was ist Ihnen bei der Arbeit wichtig?',
        passCriterion: 'One fluent "Für mich ist vor allem … wichtig."',
      },
      {
        id: 'ec3',
        question: 'Und wie war das bei Ihnen mit der Qualitätssicherung?',
        passCriterion: 'You use a survival/recovery chunk instead of freezing, then answer.',
      },
    ],
  },

  retrievalChallenge: {
    timeLimitSeconds: 60,
    slowThresholdSeconds: 3,
    repeatOfferLabel: '5× wiederholen',
    prompts: [
      { id: 'rc1', cue: 'Say: "For me, reliability is above all important."' },
      { id: 'rc2', cue: 'Say the evidence half with: tested AI answers.' },
      { id: 'rc3', cue: 'Say the evidence half with: led a team.' },
      { id: 'rc4', cue: 'Ask for thinking time.' },
      { id: 'rc5', cue: 'Ask for the question to be rephrased.' },
      { id: 'rc6', cue: 'Restart a sentence you’ve messed up.' },
    ],
  },

  // See learningEngine/stateTransition.js: everything here is gated on the
  // exit check actually having been attempted, except seededChunksToAdd
  // (exposure to an unanalyzed fragment doesn't need production evidence).
  stateUpdateRules: {
    seededChunksToAdd: ['Deshalb passt das gut.'],
    chunksToAdd: [
      'Für mich ist vor allem … wichtig.',
      'Bei … habe ich …',
      'In meinem … habe ich …',
      'Darf ich kurz nachdenken?',
      'Können Sie die Frage bitte noch einmal anders formulieren?',
      'Ich formuliere das noch einmal:',
      'Wie heißt das auf Deutsch … ?',
    ],
    knownFormsToAdd: [{ slot: 'F01', pattern: '<Kernaussage>. Bei <Projekt> habe ich <Handlung>.' }],
    movesToSupported: ['M01', 'M02', 'M04'],
    // F01 intentionally NOT added here - per spec §3.1 a frame needs a
    // second anchor plus one transformation before it's "stable", not just
    // one lesson's worth of substitution. Confirmed by the lesson's own
    // worked STATE_UPDATE: `promoted_to_stable_frames: []`.
    stableFramesToAdd: [],
    registerToAdd: [],
    // Informational only (not gating): the failure modes (spec §9.2) this
    // lesson most directly targets - E1 (vague answer) and E2 (no result)
    // are what the Kernaussage→Beleg frame itself corrects.
    failureModesDrilled: ['E1', 'E2'],
  },
};
