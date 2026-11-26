import { api } from '../api.js';
import { getDictionary, normalizeWord } from '../state.js';
import { renderClickableGermanText } from '../components/clickableGermanText.js';
import { showWordMenu, hideWordMenu, showPatternConfirm } from '../wordMenu.js';
import { buildFreeNote, textareaFocus } from './worksheets.js';

// Office roleplay game (see docs/office-game.md) - start a game, see a
// scene with two choices, pick one, see the next scene follow from that
// choice, with the XP/Chef-Meinung bars updating immediately. The
// current scene/choices/stats always live server-side (routes/game.js) -
// this view just renders whatever the server last said and sends back a
// choice index, so a page refresh always resumes exactly where it left off.
//
// Every German word in the scene/outcome/choices is clickable exactly like
// in the book reader - reuses clickableGermanText.js directly (same
// component worksheets.js already reuses), not a reimplementation. "Extract
// pattern (AI)" on a multi-word selection also reuses the exact same AI
// call + confirm UI worksheets.js's own version does (see
// startExtractPatternInGame below), adapted for plain main-document text
// instead of an iframe (so none of worksheets.js's frame-coordinate
// handling is needed here).
export async function renderGame(host) {
  host.innerHTML = '<div class="loading">Spiel wird geladen…</div>';

  let game = null;
  try {
    game = await api.getCurrentGame();
  } catch {
    // No game in progress yet (or a transient error) - either way, the
    // start screen below is the right place to land and try again.
  }

  if (game && game.type === 'check') {
    renderSkillCheck(host, game);
  } else if (game && game.status === 'fired') {
    await renderGameOver(host, game);
  } else if (game) {
    await renderScene(host, game);
  } else {
    renderStartScreen(host);
  }
}

function renderStartScreen(host) {
  host.innerHTML = `
    <div class="libraryHeader">
      <h1>Büro-Rollenspiel</h1>
    </div>
    <p class="hint">
      Du bist neu bei "Brandt &amp; Partner GmbH". Jede Runde schreibt die KI eine kurze Szene auf Deutsch und
      gibt dir zwei Möglichkeiten - du wählst, und die Geschichte geht weiter.
    </p>
    <button class="button" id="startBtn" type="button">Spiel starten</button>
    <div id="gameStatus"></div>
  `;

  const btn = host.querySelector('#startBtn');
  const status = host.querySelector('#gameStatus');
  btn.onclick = async () => {
    btn.disabled = true;
    status.textContent = 'Die KI schreibt die erste Szene…';
    status.className = 'importStatus';
    try {
      const game = await api.startGame();
      await renderScene(host, game);
    } catch (err) {
      status.textContent = `Fehler: ${err.message}`;
      status.className = 'importStatus error';
      btn.disabled = false;
    }
  };
}

async function restartGame(host) {
  host.innerHTML = '<div class="loading">Neues Spiel wird gestartet…</div>';
  try {
    const freshGame = await api.startGame();
    await renderScene(host, freshGame);
  } catch (err) {
    host.innerHTML = `<div class="error">Fehler: ${escapeHtml(err.message)}</div>`;
  }
}

function renderStatBars(host, game) {
  host.querySelector('#xpBar').style.width = `${Math.min(100, game.xp)}%`;
  host.querySelector('#xpValue').textContent = game.xp;
  host.querySelector('#chefBar').style.width = `${game.chefMeinung}%`;
  host.querySelector('#chefValue').textContent = game.chefMeinung;
}

// Briefly shows a floating "+20 XP" / "−6" next to the relevant bar right
// after a choice, then fades it out - purely a visual "something just
// changed" cue, not persisted anywhere.
function showFloatingDelta(host, effects) {
  if (!effects || !effects.length) return;
  for (const effect of effects) {
    const anchorId = effect.target === 'xp' ? '#xpFloat' : effect.target === 'chef_meinung' ? '#chefFloat' : null;
    if (!anchorId) continue;
    const anchor = host.querySelector(anchorId);
    if (!anchor || !effect.delta) continue;
    const el = document.createElement('span');
    el.className = `gameFloatingDelta ${effect.delta >= 0 ? 'gameFloatingDeltaUp' : 'gameFloatingDeltaDown'}`;
    el.textContent = `${effect.delta >= 0 ? '+' : ''}${effect.delta}`;
    anchor.appendChild(el);
    setTimeout(() => el.remove(), 1600);
  }
}

// A target word's inflected form in the actual scene text rarely matches
// its dictionary form exactly - this is the exact same loose "stem"
// heuristic routes/game.js's own game/vocab.js uses server-side to verify
// words_used, just duplicated here (not worth a shared module for 4 lines)
// because this one is purely cosmetic (which .word spans get the
// highlight class) and never touches the database the way the server's
// copy does.
function wordStem(word) {
  const w = word.toLowerCase();
  if (w.length > 4) return w.slice(0, w.length - 2);
  return w;
}

function highlightTargetWords(container, targetWords) {
  if (!targetWords || !targetWords.length) return;
  const stems = targetWords.map(wordStem);
  container.querySelectorAll('.word').forEach((span) => {
    const tokenLower = (span.dataset.word || '').toLowerCase();
    if (stems.some((stem) => tokenLower.startsWith(stem))) {
      span.classList.add('gameTargetWord');
    }
  });
}

// "Extract pattern (AI)" for the game - same feature as the reader's and
// worksheets' right-click menu (see worksheets.js's
// startExtractPatternInWorksheet, itself based on reader.js's
// startExtractPattern), adapted for plain game narration text: there's no
// parallel Persian sentence here either, so it's passed as empty context.
function startExtractPatternInGame(anchorEl, text, dictionary) {
  const contextSentence = anchorEl.textContent || text;
  api
    .extractPattern(text, contextSentence, '')
    .then(({ pattern, translation }) => {
      showPatternConfirm(anchorEl, pattern, translation, async (finalPattern, finalTranslation) => {
        await api.updateDictionaryGloss(finalPattern, finalTranslation);
        dictionary[normalizeWord(finalPattern)] = finalTranslation;
        await api.markWordUnknown(finalPattern, finalTranslation);
      });
    })
    .catch((err) => {
      alert(`Could not extract pattern: ${err.message}`);
    });
}

// A free note with the AI, right on the game page - same component
// worksheets.js's "+ Notiz" boxes use (buildFreeNote, including the exact
// same "/ai <question> ... ---" convention), just given game.js's own
// backing: no persistence (a scene is gone the moment the next turn
// starts, so there's nothing meaningful to save across a reload) and
// api.askGameAi instead of api.askWorksheetAi, which has the server hand
// the AI call the CURRENT scene/choices as context (see routes/game.js's
// /ask-ai) - never tags/numbers, only what's already shown in the UI.
// Appended into `notesArea` (below the scene, not position-anchored the
// way a worksheet note is - there's no stable "block" to anchor to once
// the whole scene is replaced every turn) and purely additive: nothing
// here touches game state, so opening or using it never interrupts play.
function addGameNote(notesArea) {
  const note = buildFreeNote(document, {
    text: '',
    askAi: (question) => api.askGameAi(question),
    onCreate: async () => ({ id: null }),
    onUpdate: async () => {},
    onDelete: async () => {},
  });
  notesArea.appendChild(note);
  textareaFocus(note);
}

// Right-click anywhere inside `container` shows "Notiz hinzufügen" (always)
// and, on a multi-word selection, "Extract pattern (AI)" too - same
// selection rule (must span more than one word) worksheets.js's version uses.
function wireUpExtractPattern(container, dictionary, notesArea) {
  container.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    const items = [{ label: 'Notiz hinzufügen', onClick: () => addGameNote(notesArea) }];
    const selection = document.getSelection();
    const selectedText = selection && !selection.isCollapsed ? selection.toString().trim() : '';
    if (selectedText.includes(' ')) {
      items.push({ label: 'Extract pattern (AI)', onClick: () => startExtractPatternInGame(container, selectedText, dictionary) });
    }
    showWordMenu(e.clientX, e.clientY, items);
  });
}

async function renderScene(host, game) {
  host.innerHTML = `
    <div class="libraryHeader">
      <h1>Büro-Rollenspiel</h1>
      <button class="button" id="restartBtn" type="button">Neu anfangen</button>
    </div>
    <div class="gameStats">
      <div class="gameStatRow">
        <span class="gameStatLabel">XP</span>
        <div class="gameBarTrack"><div class="gameBarFill gameBarXp" id="xpBar"></div></div>
        <span class="gameStatValue" id="xpValue">0</span>
        <span class="gameFloatAnchor" id="xpFloat"></span>
      </div>
      <div class="gameStatRow">
        <span class="gameStatLabel">Chef-Meinung</span>
        <div class="gameBarTrack"><div class="gameBarFill gameBarChef" id="chefBar"></div></div>
        <span class="gameStatValue" id="chefValue">0</span>
        <span class="gameFloatAnchor" id="chefFloat"></span>
      </div>
    </div>
    ${game.outcome ? '<p class="gameOutcome" dir="ltr"><span id="gameOutcomeText"></span></p>' : ''}
    <p class="gameScene" dir="ltr"><span id="gameSceneText"></span></p>
    <div class="gameChoices">
      <div class="gameChoiceBtn" data-choice="0" tabindex="0" role="button"></div>
      <div class="gameChoiceBtn" data-choice="1" tabindex="0" role="button"></div>
    </div>
    <div id="gameNotesArea"></div>
    <div id="gameStatus"></div>
  `;

  renderStatBars(host, game);
  showFloatingDelta(host, game.effects);

  const dictionary = await getDictionary();
  const textOptions = { dictionary, bookId: 'office-game', page: game.turn };
  const notesArea = host.querySelector('#gameNotesArea');

  const sceneEl = host.querySelector('#gameSceneText');
  renderClickableGermanText(sceneEl, game.scene, textOptions);
  wireUpExtractPattern(sceneEl, dictionary, notesArea);
  highlightTargetWords(sceneEl, game.targetWords);

  const outcomeEl = host.querySelector('#gameOutcomeText');
  if (outcomeEl) {
    renderClickableGermanText(outcomeEl, game.outcome, textOptions);
    wireUpExtractPattern(outcomeEl, dictionary, notesArea);
  }

  const choiceEls = host.querySelectorAll('.gameChoiceBtn');
  choiceEls.forEach((choiceEl, i) => {
    renderClickableGermanText(choiceEl, game.choices[i].text, textOptions);
    wireUpExtractPattern(choiceEl, dictionary, notesArea);
    highlightTargetWords(choiceEl, game.targetWords);
  });

  // Clicking a word inside a choice must only show its translation (the
  // word's own click handler, wired by renderClickableGermanText above),
  // never ALSO select that choice - checked here, at the choice
  // container's own click handler, rather than by changing
  // clickableGermanText.js itself, which has no idea it might ever be
  // placed inside something else clickable.
  const status = host.querySelector('#gameStatus');
  choiceEls.forEach((choiceEl) => {
    choiceEl.addEventListener('click', async (e) => {
      if (e.target.closest('.word')) return;
      if (choiceEl.classList.contains('gameChoiceDisabled')) return;
      choiceEls.forEach((el) => el.classList.add('gameChoiceDisabled'));
      status.textContent = 'Die KI schreibt die nächste Szene…';
      status.className = 'importStatus';
      try {
        const nextGame = await api.chooseGameOption(Number(choiceEl.dataset.choice));
        if (nextGame.type === 'check') {
          renderSkillCheck(host, nextGame);
        } else if (nextGame.status === 'fired') {
          await renderGameOver(host, nextGame);
        } else {
          await renderScene(host, nextGame);
        }
      } catch (err) {
        status.textContent = `Fehler: ${err.message}`;
        status.className = 'importStatus error';
        choiceEls.forEach((el) => el.classList.remove('gameChoiceDisabled'));
      }
    });
  });

  host.querySelector('#restartBtn').onclick = () => restartGame(host);
}

async function renderGameOver(host, game) {
  host.innerHTML = `
    <div class="libraryHeader">
      <h1>Büro-Rollenspiel</h1>
    </div>
    <div class="lessonSummary" dir="ltr">
      <h2>🔥 Gefeuert!</h2>
      ${game.outcome ? '<p class="gameOutcome" dir="ltr"><span id="gameOutcomeText"></span></p>' : ''}
      <p class="gameScene" dir="ltr"><span id="gameSceneText"></span></p>
      <div id="gameNotesArea"></div>
      <p class="hint" style="padding:0">Finale XP: ${game.xp}</p>
      <button class="button" id="restartBtn" type="button">Neu anfangen</button>
    </div>
  `;

  const dictionary = await getDictionary();
  const textOptions = { dictionary, bookId: 'office-game', page: game.turn };
  const notesArea = host.querySelector('#gameNotesArea');
  const sceneEl = host.querySelector('#gameSceneText');
  renderClickableGermanText(sceneEl, game.scene, textOptions);
  wireUpExtractPattern(sceneEl, dictionary, notesArea);
  const outcomeEl = host.querySelector('#gameOutcomeText');
  if (outcomeEl) {
    renderClickableGermanText(outcomeEl, game.outcome, textOptions);
    wireUpExtractPattern(outcomeEl, dictionary, notesArea);
  }

  host.querySelector('#restartBtn').onclick = () => restartGame(host);
}

function shuffleIndexes(n) {
  const arr = Array.from({ length: n }, (_, i) => i);
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// A skill check ("Probe!") - presents the 1-2 exercises the server
// generated for the choice the player just picked (see
// routes/game.js's POST /choose, server/src/game/skillCheck.js), reusing
// the SAME exercise shapes and CSS as Practice's scramble/matching steps
// (see client/src/components/LessonPlayer.js) so a check looks and feels
// like the exercises the player already knows, just shown inline here
// rather than as its own lesson step. Answers are checked server-side
// (routes/game.js's POST /skill-check-answer) - this view just collects
// them and shows whatever scene/outcome comes back, exactly like a normal
// choice would.
function renderSkillCheck(host, game) {
  host.innerHTML = `
    <div class="libraryHeader">
      <h1>Büro-Rollenspiel</h1>
    </div>
    <p class="gameOutcome" dir="ltr">⚡ ${game.difficulty === 'hard' ? 'Schwierige Probe!' : 'Probe!'}</p>
    <div id="skillCheckExercises"></div>
    <button class="button" id="skillCheckSubmit" type="button">Fertig</button>
    <div id="gameStatus"></div>
  `;

  const container = host.querySelector('#skillCheckExercises');
  const getAnswers = game.exercises.map((exercise) => renderSkillCheckExercise(container, exercise));

  const btn = host.querySelector('#skillCheckSubmit');
  const status = host.querySelector('#gameStatus');
  btn.onclick = async () => {
    btn.disabled = true;
    status.textContent = 'Wird überprüft…';
    status.className = 'importStatus';
    try {
      const answers = getAnswers.map((getAnswer) => getAnswer());
      const nextGame = await api.submitSkillCheckAnswers(answers);
      if (nextGame.status === 'fired') {
        await renderGameOver(host, nextGame);
      } else {
        await renderScene(host, nextGame);
      }
    } catch (err) {
      status.textContent = `Fehler: ${err.message}`;
      status.className = 'importStatus error';
      btn.disabled = false;
    }
  };
}

// Renders one exercise into `container` and returns a getAnswer() function
// matching the shape routes/game.js's POST /skill-check-answer expects for
// that exercise's type: a string for translate/scramble, or an array of
// {german, persian} pairs for matching.
function renderSkillCheckExercise(container, exercise) {
  const box = document.createElement('div');
  box.className = 'skillCheckExercise';
  container.appendChild(box);

  if (exercise.type === 'matching') return renderSkillCheckMatching(box, exercise);
  if (exercise.type === 'scramble') return renderSkillCheckScramble(box, exercise);
  return renderSkillCheckTranslate(box, exercise);
}

function renderSkillCheckTranslate(box, exercise) {
  box.innerHTML = `
    <p class="lessonPromptFa" dir="rtl">${escapeHtml(exercise.promptFa)}</p>
    <input type="text" class="answerInput" dir="ltr" autocomplete="off" autocapitalize="off" spellcheck="false">
  `;
  const input = box.querySelector('input');
  return () => input.value;
}

function renderSkillCheckScramble(box, exercise) {
  box.innerHTML = `
    <p class="lessonPromptFa" dir="rtl">${escapeHtml(exercise.promptFa)}</p>
    <div class="scrambleBuilt"></div>
    <div class="scrambleTiles"></div>
  `;
  const builtEl = box.querySelector('.scrambleBuilt');
  const tilesEl = box.querySelector('.scrambleTiles');
  const order = shuffleIndexes(exercise.words.length);
  let built = [];

  function render() {
    builtEl.innerHTML = '';
    built.forEach((idx) => {
      const tile = document.createElement('button');
      tile.type = 'button';
      tile.className = 'scrambleTile scrambleTileBuilt';
      tile.textContent = exercise.words[idx];
      tile.onclick = () => {
        built = built.filter((i) => i !== idx);
        render();
      };
      builtEl.appendChild(tile);
    });
    tilesEl.innerHTML = '';
    order.filter((idx) => !built.includes(idx)).forEach((idx) => {
      const tile = document.createElement('button');
      tile.type = 'button';
      tile.className = 'scrambleTile';
      tile.textContent = exercise.words[idx];
      tile.onclick = () => {
        built.push(idx);
        render();
      };
      tilesEl.appendChild(tile);
    });
  }
  render();
  return () => built.map((idx) => exercise.words[idx]).join(' ');
}

// Unlike LessonPlayer's own matching step (where the correct pairing is
// "same shuffled position" by construction - see its renderMatchingStep),
// a skill check must let the player connect ANY german chip to ANY
// persian chip, since the whole point is testing whether they actually
// know which meaning goes with which word. Whatever pairing they form -
// right or wrong - is sent as-is; the server (checkExerciseAnswer) is the
// only thing that judges it.
function renderSkillCheckMatching(box, exercise) {
  box.innerHTML = `
    <div class="matchingBoard">
      <div class="matchingCol" dir="ltr"></div>
      <div class="matchingCol" dir="rtl"></div>
    </div>
  `;
  const [germanCol, persianCol] = box.querySelectorAll('.matchingCol');
  const germanOrder = shuffleIndexes(exercise.pairs.length);
  const persianOrder = shuffleIndexes(exercise.pairs.length);
  const matched = new Map(); // germanIdx -> persianIdx
  let selectedGerman = null;
  let selectedPersian = null;

  function render() {
    germanCol.innerHTML = '';
    germanOrder.forEach((idx) => {
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'matchingChip';
      chip.textContent = exercise.pairs[idx].german;
      if (matched.has(idx)) chip.classList.add('matchingChipMatched');
      if (selectedGerman === idx) chip.classList.add('matchingChipSelected');
      chip.disabled = matched.has(idx);
      chip.onclick = () => {
        selectedGerman = idx;
        tryMatch();
        render();
      };
      germanCol.appendChild(chip);
    });
    persianCol.innerHTML = '';
    persianOrder.forEach((idx) => {
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'matchingChip';
      chip.textContent = exercise.pairs[idx].persian;
      const isMatched = [...matched.values()].includes(idx);
      if (isMatched) chip.classList.add('matchingChipMatched');
      if (selectedPersian === idx) chip.classList.add('matchingChipSelected');
      chip.disabled = isMatched;
      chip.onclick = () => {
        selectedPersian = idx;
        tryMatch();
        render();
      };
      persianCol.appendChild(chip);
    });
  }
  function tryMatch() {
    if (selectedGerman === null || selectedPersian === null) return;
    matched.set(selectedGerman, selectedPersian);
    selectedGerman = null;
    selectedPersian = null;
  }
  render();
  return () => [...matched.entries()].map(([gIdx, pIdx]) => ({ german: exercise.pairs[gIdx].german, persian: exercise.pairs[pIdx].persian }));
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}
