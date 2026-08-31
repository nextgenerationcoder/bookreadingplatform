// Speech-to-text for LessonPlayer's spoken-answer input - self-hosted,
// German-tuned Whisper large-v3 turbo (see docker-compose.yml's `whisper`
// service). No API key: it's our own container, reachable only from this
// server, never exposed publicly.
//
// whisper-asr-webservice has no repeated-hotwords field; the closest
// equivalent is `initial_prompt`, a free-text nudge fed to the decoder as
// preceding context. Callers should only pass words the learner has
// already been shown (e.g. a step's newly-taught vocabulary) - never the
// full expected answer, or the model would just be nudged toward
// recognizing that answer regardless of what was actually said, defeating
// the point of an active-recall check.

const WHISPER_URL = process.env.WHISPER_URL || 'http://whisper:9000';

export async function transcribeAudio({ audioBuffer, mimeType, filename = 'audio.wav', hotwords }) {
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
  return (data.text || '').trim();
}
