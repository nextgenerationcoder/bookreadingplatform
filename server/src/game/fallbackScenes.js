// A small pool of handwritten scenes, used ONLY when the real AI call for
// a turn (game/ai.js's runGameTurnOrFallback) has failed TWICE in a row -
// so a short AI outage degrades to "a bit less varied for one turn"
// instead of a hard error that stops the game dead. Deliberately generic
// (no specific prior outcome narrated, since a canned scene can't know
// what actually just happened) but still B1 German, still in-character,
// still following the same "mostly dialogue, 2-4 sentences" rule as a
// real AI turn (see game/prompt.js's content rules) - a learner shouldn't
// be able to tell "this is the fallback" just from how it reads.
//
// `check` is ALWAYS null on every fallback choice - triggering a skill
// check would itself need another AI call (game/skillCheck.js), which is
// exactly the kind of call that's failing right now, so a fallback scene
// must never offer one.

const FALLBACK_SCENES = [
  {
    outcome: 'Der Tag geht erstmal ruhig weiter.',
    scene:
      'In der Kaffeeküche trifft dich Jonas. "Hast du schon gehört?", flüstert er. "Herr Becker hat wohl einen Fehler im Bericht gemacht." Er grinst erwartungsvoll.',
    choices: [
      { text: 'Ich will die Details wissen.', tags: { frech: 1, chef_sieht: false, betrifft: 'jonas', flirt: false, check: null } },
      { text: 'Ich habe keine Zeit für Klatsch und gehe weiter.', tags: { frech: 0, chef_sieht: false, betrifft: null, flirt: false, check: null } },
    ],
  },
  {
    outcome: 'Der Tag geht erstmal ruhig weiter.',
    scene: 'Frau Krüger ruft ein kurzes Meeting zusammen. "Der Kunde braucht die Unterlagen bis heute Abend", sagt sie und schaut dich direkt an.',
    choices: [
      { text: '"Kein Problem, ich erledige das sofort."', tags: { frech: 0, chef_sieht: true, betrifft: 'krueger', flirt: false, check: null } },
      { text: '"Das wird eng - können wir das auf morgen verschieben?"', tags: { frech: 1, chef_sieht: true, betrifft: 'krueger', flirt: false, check: null } },
    ],
  },
  {
    outcome: 'Der Tag geht erstmal ruhig weiter.',
    scene: 'In deinem Postfach wartet eine dringende E-Mail von einem wichtigen Kunden. Er klingt verärgert über eine verspätete Lieferung.',
    choices: [
      { text: 'Ich schreibe eine ruhige, professionelle Antwort.', tags: { frech: 0, chef_sieht: false, betrifft: null, flirt: false, check: null } },
      { text: 'Ich leite die E-Mail einfach an Herrn Becker weiter.', tags: { frech: 2, chef_sieht: false, betrifft: 'becker', flirt: false, check: null } },
    ],
  },
  {
    outcome: 'Der Tag geht erstmal ruhig weiter.',
    scene: 'Das Telefon klingelt. Ein Kunde fragt ungeduldig nach dem Stand seiner Bestellung. "Das dauert mir alles viel zu lange!", sagt er.',
    choices: [
      { text: 'Ich bleibe freundlich und erkläre die Lage genau.', tags: { frech: 0, chef_sieht: false, betrifft: null, flirt: false, check: null } },
      { text: 'Ich sage, dass ich gerade keine Zeit habe, und lege auf.', tags: { frech: 2, chef_sieht: true, betrifft: null, flirt: false, check: null } },
    ],
  },
  {
    outcome: 'Der Tag geht erstmal ruhig weiter.',
    scene: 'Im Flur läuft dir Herr Becker entgegen. "Na, schon wieder spät dran?", sagt er mit einem spöttischen Lächeln.',
    choices: [
      { text: 'Ich ignoriere die Bemerkung und gehe weiter.', tags: { frech: 0, chef_sieht: false, betrifft: 'becker', flirt: false, check: null } },
      { text: '"Lieber spät als schlecht, wie bei deinem letzten Bericht."', tags: { frech: 3, chef_sieht: false, betrifft: 'becker', flirt: false, check: null } },
    ],
  },
  {
    outcome: 'Der Tag geht erstmal ruhig weiter.',
    scene: 'Nach der Arbeit schlägt Lena vor, noch auf einen Kaffee zu bleiben. "Du hast dir eine Pause verdient", sagt sie lächelnd.',
    choices: [
      { text: 'Ich bleibe gerne noch mit ihr.', tags: { frech: 1, chef_sieht: false, betrifft: 'lena', flirt: true, check: null } },
      { text: 'Ich bedanke mich, muss aber los.', tags: { frech: 0, chef_sieht: false, betrifft: 'lena', flirt: false, check: null } },
    ],
  },
];

const FALLBACK_OPENING_SCENE = {
  outcome: '',
  scene: 'Dein erster Tag bei Brandt & Partner GmbH beginnt. Frau Krüger begrüßt dich kurz an der Tür. "Willkommen im Team", sagt sie. "Fangen wir gleich an."',
  choices: [
    { text: '"Ich bin bereit, legen wir los."', tags: { frech: 0, chef_sieht: true, betrifft: 'krueger', flirt: false, check: null } },
    { text: '"Können Sie mir kurz das Büro zeigen?"', tags: { frech: 0, chef_sieht: true, betrifft: 'krueger', flirt: false, check: null } },
  ],
};

const FALLBACK_FIRING_SCENE = {
  outcome: 'Dein Verhalten in letzter Zeit ist nicht unbemerkt geblieben.',
  scene: 'Frau Krüger bittet dich in ihr Büro. "Das funktioniert so nicht mehr", sagt sie ernst. "Wir müssen uns leider trennen." Du räumst still deinen Schreibtisch.',
  choices: [],
};

function clonedChoices(choices) {
  return choices.map((c) => ({ text: c.text, tags: { ...c.tags } }));
}

// Returns something in the exact shape runGameTurn()/validateGameTurn()
// produce ({outcome, scene, choices, summary, wordsUsed}) so every caller
// (resolveChoice, the vocab-verification pass, ...) can treat a fallback
// turn exactly like a real one. `summary: null` is a sentinel the caller
// reads as "keep whatever summary we already had" (see routes/game.js's
// resolveChoice) - a canned scene has nothing meaningful to add to the
// running story recap, so it leaves continuity alone rather than
// overwriting it with something generic.
export function pickFallbackScene(fired = false) {
  if (fired) {
    return { ...FALLBACK_FIRING_SCENE, choices: [], summary: null, wordsUsed: [] };
  }
  const scene = FALLBACK_SCENES[Math.floor(Math.random() * FALLBACK_SCENES.length)];
  return { outcome: scene.outcome, scene: scene.scene, choices: clonedChoices(scene.choices), summary: null, wordsUsed: [] };
}

// The very first turn of a new game has no prior summary to preserve, so
// this supplies its own short one instead of the null sentinel above.
export function pickFallbackOpeningScene() {
  return {
    outcome: FALLBACK_OPENING_SCENE.outcome,
    scene: FALLBACK_OPENING_SCENE.scene,
    choices: clonedChoices(FALLBACK_OPENING_SCENE.choices),
    summary: 'Der erste Arbeitstag bei Brandt & Partner GmbH hat gerade begonnen.',
    wordsUsed: [],
  };
}
