// Z.AI's speech-to-text endpoint only accepts .wav/.mp3, but browsers'
// MediaRecorder produces webm (Chrome/Firefox) or mp4 (Safari) - neither of
// which Z.AI accepts. This decodes whatever the browser recorded via the
// Web Audio API and re-encodes it as 16-bit PCM WAV before upload.
export async function blobToWav(blob) {
  const arrayBuffer = await blob.arrayBuffer();
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  const audioCtx = new AudioContextClass();
  try {
    const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer);
    return new Blob([encodeWav(audioBuffer)], { type: 'audio/wav' });
  } finally {
    audioCtx.close();
  }
}

function encodeWav(audioBuffer) {
  const sampleRate = audioBuffer.sampleRate;
  const numFrames = audioBuffer.length;

  // Downmix to mono - speech recognition doesn't need stereo, and it keeps
  // the encoder (and the resulting file) simple.
  let samples;
  if (audioBuffer.numberOfChannels === 1) {
    samples = audioBuffer.getChannelData(0);
  } else {
    const ch0 = audioBuffer.getChannelData(0);
    const ch1 = audioBuffer.getChannelData(1);
    samples = new Float32Array(numFrames);
    for (let i = 0; i < numFrames; i++) samples[i] = (ch0[i] + ch1[i]) / 2;
  }

  const bytesPerSample = 2; // 16-bit PCM
  const dataSize = samples.length * bytesPerSample;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);

  function writeString(offset, str) {
    for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i));
  }

  writeString(0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  writeString(8, 'WAVE');
  writeString(12, 'fmt ');
  view.setUint32(16, 16, true); // PCM chunk size
  view.setUint16(20, 1, true); // format = PCM
  view.setUint16(22, 1, true); // channels = 1 (mono)
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * bytesPerSample, true); // byte rate
  view.setUint16(32, bytesPerSample, true); // block align
  view.setUint16(34, 16, true); // bits per sample
  writeString(36, 'data');
  view.setUint32(40, dataSize, true);

  let offset = 44;
  for (let i = 0; i < samples.length; i++, offset += 2) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }

  return buffer;
}
