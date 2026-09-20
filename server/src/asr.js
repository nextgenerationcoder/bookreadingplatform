// Speech-to-text for LessonPlayer's spoken-answer input. Groq's hosted
// Whisper API is the only provider - it used to be a choice between this and
// a self-hosted Whisper container, but that container's model weights ate
// ~1.4GB of RAM on the VPS for a feature Groq already covers well (and much
// faster, running on Groq's inference hardware instead of this VPS's CPU),
// so it was removed - see docker-compose.yml's git history for the old
// `whisper` service.
//
// Has no repeated-hotwords field; the closest equivalent is a free-text
// `prompt` fed to the decoder as preceding context. Callers should only pass
// words the learner has already been shown (e.g. a step's newly-taught
// vocabulary) - never the full expected answer, or the model would just be
// nudged toward recognizing that answer regardless of what was actually
// said, defeating the point of an active-recall check.

const GROQ_MODEL = 'whisper-large-v3';

const ASR_PROVIDERS = {
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
  const impl = ASR_PROVIDERS[provider] || ASR_PROVIDERS.groq;
  if (!apiKey) throw new Error('No Groq API key configured - add one in Settings to use the mic button.');
  return (await impl.call(apiKey, audioBuffer, mimeType, filename, { hotwords })).trim();
}
