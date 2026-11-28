// Chunking for Shadowing mode (listen-then-repeat drill) - ported exactly
// from the user's own shadowing_pipeline.py: split on punctuation (,/.
// only - NOT ?/!, matching that script precisely), then merge any chunk
// under 3.5s into its neighbor, repeatedly, as long as the combined
// duration stays at or under 5.0s. A chunk that can't be merged without
// busting that cap is kept exactly as-is, never dropped.
//
// Different goal from hoerenChunker.js's buildHoerenChunks: that one makes
// clause/sentence-sized chunks (~4s, header/filler-aware) for listening-
// along navigation on a Hören page. This one makes short, phrase-sized
// chunks a learner can realistically repeat out loud in the pause that
// follows (see reader.js's playShadowingChunk for how that pause itself is
// sized, per shadowing_pipeline.py's own "slowed duration" floor).
import { chunkByPunctuation, mergeShortChunks } from './chunkingCore.js';

export function groupWordsIntoChunks(words, { mergeBelow = 3.5, hardCap = 5.0 } = {}) {
  return mergeShortChunks(chunkByPunctuation(words), { mergeBelow, hardCap });
}
