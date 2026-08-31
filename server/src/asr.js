// Speech-to-text for LessonPlayer's spoken-answer input, via Z.AI's
// GLM-ASR-2512 model (https://docs.z.ai/guides/audio/glm-asr-2512).
// Z.AI only accepts .wav/.mp3 (≤25MB, ≤30s) - the browser's MediaRecorder
// output (webm/opus, mp4) is converted to WAV client-side before upload
// (see client/src/lessonEngine/audioToWav.js), so this always receives a
// valid WAV buffer.

const ASR_PROVIDERS = {
  zai: {
    model: 'glm-asr-2512',
    async call(apiKey, audioBuffer, mimeType, filename) {
      const form = new FormData();
      form.append('model', ASR_PROVIDERS.zai.model);
      form.append('stream', 'false');
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

export async function transcribeAudio({ provider, apiKey, audioBuffer, mimeType, filename = 'audio.wav' }) {
  const impl = ASR_PROVIDERS[provider];
  if (!impl) throw new Error(`Unsupported ASR provider: ${provider}`);
  return (await impl.call(apiKey, audioBuffer, mimeType, filename)).trim();
}
