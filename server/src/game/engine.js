// Pure game-mechanics engine for the office roleplay game (see
// docs/office-game.md). No DB, no AI, no I/O of any kind - CODE owns all
// numbers, and this is where that ownership actually lives: every
// function here is pure (same inputs -> same outputs, given the same rng
// sequence), which is what makes it directly testable without a database
// or a network call - see __tests__/gameEngine.test.js. The AI never sees
// or reports any of these numbers; it only ever tags a CHOICE (how cheeky
// it is, who it involves, etc. - see llm.js's GAME_TURN_CHOICE_TAGS_SCHEMA)
// and this module decides what that tag combination actually does.

// --- Tunable constants --------------------------------------------------

export const CHEF_MEINUNG_START = 50;
export const SYMPATHIE_START = 50;
export const BECKER_SYMPATHIE_START = 30; // the rival starts less fond of you
export const LENA_FLIRT_START = 0;

export const XP_PER_FRECH = 10;

// chef_sieht === true, frech === 0: the boss notices professional behavior.
export const CHEF_PROFESSIONAL_MIN = 1;
export const CHEF_PROFESSIONAL_MAX = 3;

// chef_sieht === true, frech > 0: usually annoyed, scaled by how cheeky.
export const CHEF_ANNOYED_MULT_MIN = 3;
export const CHEF_ANNOYED_MULT_MAX = 8;

// ...but sometimes she's impressed instead of annoyed.
export const CHEF_IMPRESSED_CHANCE = 0.2;
export const CHEF_IMPRESSED_MULT = 2;

// NPC sympathie swing for a cheeky (frech > 0) action involving them.
export const CHEEKY_SYMPATHIE_MIN = 2;
export const CHEEKY_SYMPATHIE_MAX = 6;

// NPC sympathie bump for a non-cheeky (frech === 0) action involving them.
export const PROFESSIONAL_SYMPATHIE_MIN = 1;
export const PROFESSIONAL_SYMPATHIE_MAX = 3;

// Which direction a CHEEKY action swings each NPC's sympathie - Jonas
// (loves gossip/mischief) and Lena are amused; Becker, the ambitious
// rival, is annoyed by it. Frau Krüger isn't in `npcs` at all - her
// reaction is chef_meinung, handled separately above.
const CHEEKY_DIRECTION = { jonas: 1, lena: 1, becker: -1 };

export const FLIRT_MIN = 5;
export const FLIRT_MAX = 10;

export const FIRED_THRESHOLD = 0;

// Skill checks (see game/skillCheck.js) - a choice tagged "easy"/"hard"
// needs the player to solve a short language exercise before its effect
// is computed. Passing it turns what would have been risky cheekiness
// into something the boss is impressed by rather than annoyed by;
// failing it makes the normal "annoyed" penalty worse, and the XP that
// cheekiness would have earned is withheld (you only earned nothing by
// trying and failing, not by trying at all) - these multipliers apply on
// top of the EXISTING frech/chef_sieht math below, not instead of it.
export const CHECK_SUCCESS_XP_MULT = 1.5;
export const CHECK_FAILURE_XP_MULT = 0;
export const CHECK_SUCCESS_CHEF_MULT = 1.5; // multiplies the normal "impressed" bonus
export const CHECK_FAILURE_CHEF_MULT = 2; // multiplies the normal "annoyed" penalty

// --- State ---------------------------------------------------------------

export function createInitialState() {
  return {
    xp: 0,
    chef_meinung: CHEF_MEINUNG_START,
    npcs: {
      jonas: { sympathie: SYMPATHIE_START },
      lena: { sympathie: SYMPATHIE_START, flirt: LENA_FLIRT_START },
      becker: { sympathie: BECKER_SYMPATHIE_START },
    },
  };
}

function clamp(n) {
  return Math.max(0, Math.min(100, n));
}

// Random integer in [min, max], inclusive. Takes an injectable rng
// (defaults to Math.random) so callers - and especially tests - can seed
// it deterministically instead of depending on real randomness.
function randInt(min, max, rng) {
  return Math.floor(rng() * (max - min + 1)) + min;
}

// Applies one chosen choice's tags to `state`, returning { state, effects }
// - a new state (the input is never mutated) and a list of
// { target, delta, reason } entries describing exactly what changed and
// why. `effects` is handed to game/prompt.js's describeEffects so the AI's
// next narration states exactly what engine.js computed, instead of
// inventing its own version of what happened.
//
// checkResult - null (no skill check for this choice), 'success', or
// 'failure' (see game/skillCheck.js) - overrides the normal frech/
// chef_sieht math below: a successful check is ALWAYS treated as
// impressing the boss (never the random annoyed roll), a failed one is
// ALWAYS treated as extra-annoyed, and the XP for the attempt is
// scaled accordingly (see the CHECK_* constants above).
export function applyChoice(state, tags, rng = Math.random, checkResult = null) {
  const next = {
    xp: state.xp,
    chef_meinung: state.chef_meinung,
    npcs: {
      jonas: { ...state.npcs.jonas },
      lena: { ...state.npcs.lena },
      becker: { ...state.npcs.becker },
    },
  };
  const effects = [];
  const frech = tags.frech || 0;

  if (frech > 0) {
    const xpMult = checkResult === 'success' ? CHECK_SUCCESS_XP_MULT : checkResult === 'failure' ? CHECK_FAILURE_XP_MULT : 1;
    const delta = Math.round(frech * XP_PER_FRECH * xpMult);
    if (delta > 0) {
      next.xp += delta;
      effects.push({ target: 'xp', delta, reason: checkResult === 'success' ? 'frech-success' : 'frech' });
    } else if (checkResult === 'failure') {
      // Still reported (delta 0) so describeEffects can narrate the failed
      // attempt even though it earned no XP - distinct from "nothing
      // happened" (no effect at all), which would omit this entirely.
      effects.push({ target: 'xp', delta: 0, reason: 'frech-failure' });
    }
  }

  if (tags.chef_sieht) {
    let delta;
    let reason;
    if (checkResult === 'success') {
      delta = frech > 0 ? frech * CHEF_IMPRESSED_MULT * CHECK_SUCCESS_CHEF_MULT : randInt(CHEF_PROFESSIONAL_MIN, CHEF_PROFESSIONAL_MAX, rng);
      reason = 'check-success';
    } else if (checkResult === 'failure') {
      delta = -((frech > 0 ? frech : 1) * randInt(CHEF_ANNOYED_MULT_MIN, CHEF_ANNOYED_MULT_MAX, rng) * CHECK_FAILURE_CHEF_MULT);
      reason = 'check-failure';
    } else if (frech === 0) {
      delta = randInt(CHEF_PROFESSIONAL_MIN, CHEF_PROFESSIONAL_MAX, rng);
      reason = 'professional';
    } else if (rng() < CHEF_IMPRESSED_CHANCE) {
      delta = frech * CHEF_IMPRESSED_MULT;
      reason = 'impressed';
    } else {
      delta = -(frech * randInt(CHEF_ANNOYED_MULT_MIN, CHEF_ANNOYED_MULT_MAX, rng));
      reason = 'annoyed';
    }
    delta = Math.round(delta);
    const before = next.chef_meinung;
    next.chef_meinung = clamp(next.chef_meinung + delta);
    effects.push({ target: 'chef_meinung', delta: next.chef_meinung - before, reason });
  }

  const betrifft = tags.betrifft;
  if (betrifft && betrifft !== 'krueger' && next.npcs[betrifft]) {
    const reason = frech > 0 ? 'cheeky' : 'professional';
    const magnitude =
      frech > 0 ? randInt(CHEEKY_SYMPATHIE_MIN, CHEEKY_SYMPATHIE_MAX, rng) : randInt(PROFESSIONAL_SYMPATHIE_MIN, PROFESSIONAL_SYMPATHIE_MAX, rng);
    const direction = frech > 0 ? (CHEEKY_DIRECTION[betrifft] ?? 1) : 1;
    const before = next.npcs[betrifft].sympathie;
    next.npcs[betrifft].sympathie = clamp(before + direction * magnitude);
    effects.push({ target: `npc:${betrifft}:sympathie`, delta: next.npcs[betrifft].sympathie - before, reason });
  }

  if (tags.flirt) {
    const delta = randInt(FLIRT_MIN, FLIRT_MAX, rng);
    const before = next.npcs.lena.flirt;
    next.npcs.lena.flirt = clamp(before + delta);
    effects.push({ target: 'npc:lena:flirt', delta: next.npcs.lena.flirt - before, reason: 'flirt' });
  }

  return { state: next, effects };
}

export function isFired(state) {
  return state.chef_meinung <= FIRED_THRESHOLD;
}
