// Converts a browser MediaRecorder recording (webm/opus in Chrome/Firefox,
// mp4/aac in Safari) into a 16-bit PCM mono WAV Blob - the format the
// self-hosted Whisper container's ffmpeg-based /asr endpoint reliably
// accepts regardless of source codec.
export async function blobToWav(blob) {
  const arrayBuffer = await blob.arrayBuffer();
  const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  let audioBuffer;
  try {
    audioBuffer = await audioCtx.decodeAudioData(arrayBuffer);
  } finally {
    audioCtx.close();
  }

  // Mono: average all channels down to one, since spoken-answer audio has
  // no reason to be stereo and it halves the encoded size.
  const numFrames = audioBuffer.length;
  const numChannels = audioBuffer.numberOfChannels;
  const mono = new Float32Array(numFrames);
  for (let ch = 0; ch < numChannels; ch++) {
    const data = audioBuffer.getChannelData(ch);
    for (let i = 0; i < numFrames; i++) mono[i] += data[i] / numChannels;
  }

  const sampleRate = audioBuffer.sampleRate;
  const bytesPerSample = 2;
  const blockAlign = bytesPerSample;
  const dataSize = numFrames * bytesPerSample;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);

  function writeString(offset, str) {
    for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i));
  }

  writeString(0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  writeString(8, 'WAVE');
  writeString(12, 'fmt ');
  view.setUint32(16, 16, true); // PCM fmt chunk size
  view.setUint16(20, 1, true); // audio format: PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * blockAlign, true); // byte rate
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bytesPerSample * 8, true); // bits per sample
  writeString(36, 'data');
  view.setUint32(40, dataSize, true);

  let offset = 44;
  for (let i = 0; i < numFrames; i++) {
    const sample = Math.max(-1, Math.min(1, mono[i]));
    view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
    offset += 2;
  }

  return new Blob([buffer], { type: 'audio/wav' });
}
