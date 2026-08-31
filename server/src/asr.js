// Speech-to-text for LessonPlayer's spoken-answer input. Two providers:
// - 'self-hosted' (default): a German-fine-tuned Whisper large-v3, running
//   in our own `whisper` container (docker-compose.yml) - no API key, and
//   tuned specifically for German rather than Z.AI's general-purpose model.
// - 'zai': Z.AI's GLM-ASR-2512 model
//   (https://docs.z.ai/guides/audio/glm-asr-2512), account-scoped API key.
// Both accept .wav (browser MediaRecorder output is converted to WAV
// client-side before upload - see client/src/lessonEngine/audioToWav.js).
//
// Z.AI's `prompt` is NOT a free-text instruction field despite how that
// might read - Z.AI's own docs describe it as "previous transcription
// results" carried forward for continuity in long, multi-chunk audio. Each
// answer here is one standalone short recording with no prior chunk, so
// there is nothing genuine to put there - sending an unrelated German
// paragraph as if it were "prior transcript" risks biasing the model
// toward continuing/echoing that text rather than helping it. Left unset.
//
// `hotwords` is the one legitimate accuracy lever this endpoint documents.
// Callers should only ever pass hotwords the learner has already been
// shown (e.g. a step's newly-taught words) - never the full expected
// answer, or the model would just be nudged toward recognizing that answer
// regardless of what was actually said, defeating the point of an active-
// recall check. Kept short and specific (the current step's new words, not
// the whole lesson's vocabulary) - a long list dilutes the "hot" signal.

// Base URL of the self-hosted Whisper container (docker-compose.yml's
// `whisper` service) - internal-only, never exposed publicly. Defaults to
// the in-cluster service DNS name; overridable for local dev against a
// whisper-asr-webservice instance run some other way.
const WHISPER_URL = process.env.WHISPER_URL || 'http://whisper:9000';

const ASR_PROVIDERS = {
  // Self-hosted, German-fine-tuned Whisper large-v3 (see docker-compose.yml)
  // - no API key: it's our own container, reachable only from this server.
  // whisper-asr-webservice has no repeated-hotwords field like Z.AI's; the
  // closest equivalent is `initial_prompt`, a free-text nudge fed to the
  // decoder as preceding context. Same accuracy-lever rules as Z.AI's
  // hotwords applied here too - only already-taught words, never the
  // expected answer itself.
  'self-hosted': {
    async call(_apiKey, audioBuffer, mimeType, filename, { hotwords } = {}) {
      const url = new URL('/asr', WHISPER_URL);
      url.searchParams.set('task', 'transcribe');
      url.searchParams.set('language', 'de');
      url.searchParams.set('output', 'json');
      if (hotwords && hotwords.length) {
        url.searchParams.set('initial_prompt', hotwords.slice(0, 20).join(', '));
      }
      const form = new FormData();
      form.append('audio_file', new Blob([audioBuffer], { type: mimeType }), filename);
      const res = await fetch(url, {
        method: 'POST',
        body: form,
        // Cold model load / CPU inference can be considerably slower than
        // Z.AI's hosted API - generous timeout so a busy first request
        // doesn't spuriously fail.
        signal: AbortSignal.timeout(60000),
      });
      if (!res.ok) {
        throw new Error(`self-hosted Whisper error (${res.status}): ${await res.text().catch(() => res.statusText)}`);
      }
      const data = await res.json();
      return data.text || '';
    },
  },
  zai: {
    model: 'glm-asr-2512',
    async call(apiKey, audioBuffer, mimeType, filename, { hotwords } = {}) {
      const form = new FormData();
      form.append('model', ASR_PROVIDERS.zai.model);
      form.append('stream', 'false');
      // hotwords is documented as an array field on a multipart request -
      // encoded the standard multipart way (repeated fields, same name),
      // not as a single JSON-stringified value.
      for (const word of (hotwords || []).slice(0, 100)) form.append('hotwords', word);
      form.append('file', new Blob([audioBuffer], { type: mimeType }), filename);
      const res = await fetch('https://api.z.ai/api/paas/v4/audio/transcriptions', {
        method: 'POST',
        headers: { authorization: `Bearer ${apiKey}` },
        body: form,
        signal: AbortSignal.timeout(30000),
      });
      if (!res.ok) throw new Error(`Z.AI API error (${res.status}): ${await res.text().catch(() => res.statusText)}`);
      const data = await res.json();
      return data.text || '';
    },
  },
};

export const ASR_PROVIDERS_LIST = Object.keys(ASR_PROVIDERS);

export async function transcribeAudio({ provider, apiKey, audioBuffer, mimeType, filename = 'audio.wav', hotwords }) {
  const impl = ASR_PROVIDERS[provider];
  if (!impl) throw new Error(`Unsupported ASR provider: ${provider}`);
  return (await impl.call(apiKey, audioBuffer, mimeType, filename, { hotwords })).trim();
}
