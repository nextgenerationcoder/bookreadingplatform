// Speech-to-text for LessonPlayer's spoken-answer input. Two providers:
// - 'self-hosted' (default, no key needed): our own German-tuned Whisper
//   large-v3 turbo container (see docker-compose.yml's `whisper` service).
//   Runs on this VPS's CPU, so a single transcription can take a while.
// - 'groq': Groq's hosted Whisper API - the same model family, but running
//   on Groq's inference hardware, dramatically faster than the CPU
//   container. Needs the account's own Groq API key.
//
// Neither has a repeated-hotwords field; the closest equivalent both share
// is a free-text `prompt`/`initial_prompt` fed to the decoder as preceding
// context. Callers should only pass words the learner has already been
// shown (e.g. a step's newly-taught vocabulary) - never the full expected
// answer, or the model would just be nudged toward recognizing that answer
// regardless of what was actually said, defeating the point of an active-
// recall check.

const WHISPER_URL = process.env.WHISPER_URL || 'http://whisper:9000';
const GROQ_MODEL = 'whisper-large-v3';

const ASR_PROVIDERS = {
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
        // Cold model load / CPU inference can take a while on the first
        // request after a redeploy - generous timeout so that doesn't
        // spuriously fail.
        signal: AbortSignal.timeout(60000),
      });
      if (!res.ok) {
        throw new Error(`self-hosted Whisper error (${res.status}): ${await res.text().catch(() => res.statusText)}`);
      }
      const data = await res.json();
      return data.text || '';
    },
  },
  groq: {
    async call(apiKey, audioBuffer, mimeType, filename, { hotwords } = {}) {
      const form = new FormData();
      form.append('model', GROQ_MODEL);
      form.append('language', 'de');
      form.append('response_format', 'json');
      if (hotwords && hotwords.length) {
        // Groq's API is OpenAI-compatible: `prompt` is a free-text context
        // hint fed to the decoder, not a repeated-field hotword list.
        form.append('prompt', hotwords.slice(0, 20).join(', '));
      }
      form.append('file', new Blob([audioBuffer], { type: mimeType }), filename);

      const res = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
        method: 'POST',
        headers: { authorization: `Bearer ${apiKey}` },
        body: form,
        signal: AbortSignal.timeout(30000),
      });
      if (!res.ok) {
        throw new Error(`Groq API error (${res.status}): ${await res.text().catch(() => res.statusText)}`);
      }
      const data = await res.json();
      return data.text || '';
    },
  },
};

export const ASR_PROVIDERS_LIST = Object.keys(ASR_PROVIDERS);

export async function transcribeAudio({ provider, apiKey, audioBuffer, mimeType, filename = 'audio.wav', hotwords }) {
  const impl = ASR_PROVIDERS[provider] || ASR_PROVIDERS['self-hosted'];
  return (await impl.call(apiKey, audioBuffer, mimeType, filename, { hotwords })).trim();
}
