// The COURSE_STATE scaffold model. A step's authored scaffoldLevel decides
// which supports the player is allowed to show - this is the single source
// of truth for that rule (also mirrored, deliberately small, in the
// client's lesson player, since there's no shared-code mechanism between
// this server and the Vite client in this repo).
//
// S3: full model sentence + word bank
// S2: frame skeleton only, no word bank
// S1: a bare cue, no frame and no model
// S0: the raw prompt only - no preparatory support at all

export const SCAFFOLD_LEVELS = ['S3', 'S2', 'S1', 'S0'];

export function visibleAidsForScaffold(scaffoldLevel) {
  switch (scaffoldLevel) {
    case 'S3':
      return { showModel: true, showFrame: true, showWordBank: true };
    case 'S2':
      return { showModel: false, showFrame: true, showWordBank: false };
    case 'S1':
      return { showModel: false, showFrame: false, showWordBank: false };
    case 'S0':
    default:
      return { showModel: false, showFrame: false, showWordBank: false };
  }
}
