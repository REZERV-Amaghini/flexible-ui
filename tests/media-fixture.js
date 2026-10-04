'use strict';
// Synthetic local PCM only. Measurement does not read any real website audio.
const sampleRate = 48000, seconds = 60, bytes = new ArrayBuffer(44 + sampleRate * seconds * 2), wav = new DataView(bytes);
function ascii(offset, value) { for (let i = 0; i < value.length; i++) wav.setUint8(offset + i, value.charCodeAt(i)); }
ascii(0, 'RIFF');wav.setUint32(4, bytes.byteLength - 8, true);ascii(8, 'WAVE');ascii(12, 'fmt ');wav.setUint32(16, 16, true);
wav.setUint16(20, 1, true);wav.setUint16(22, 1, true);wav.setUint32(24, sampleRate, true);wav.setUint32(28, sampleRate * 2, true);
wav.setUint16(32, 2, true);wav.setUint16(34, 16, true);ascii(36, 'data');wav.setUint32(40, bytes.byteLength - 44, true);
for (let i = 0; i < sampleRate * seconds; i++) wav.setInt16(44 + i * 2, Math.sin(i / sampleRate * Math.PI * 2 * 440) * 8000, true);
const source = URL.createObjectURL(new Blob([bytes], { type: 'audio/wav' }));let media = document.getElementById('fixture-media'), context, graph;
function observe() {
  document.getElementById('media-result').textContent = JSON.stringify({ rate: media.playbackRate, preservesPitch: media.preservesPitch,
    time: media.currentTime, paused: media.paused, muted: media.muted, controller: LiquidPlayback.getState() }, null, 2);
}
media.src = source;
document.getElementById('media-start').onclick = async () => { await media.play();observe(); };
document.getElementById('media-observe').onclick = observe;
document.getElementById('media-replace').onclick = () => {
  media.pause();const next = document.createElement(media.localName);next.id = media.id;next.controls = true;next.muted = true;next.src = source;
  media.replaceWith(next);media = next;setTimeout(observe, 0);
};
document.getElementById('media-spectrum').onclick = async () => {
  if (!media.captureStream) { document.getElementById('media-result').textContent = 'captureStream unavailable';return; }
  context ||= new AudioContext();await context.resume();await media.play();
  graph?.disconnect();graph = context.createMediaStreamSource(media.captureStream());const analyser = context.createAnalyser();analyser.fftSize = 32768;
  graph.connect(analyser); // No connection to destination: measurement emits no sound.
  setTimeout(() => {
    const spectrum = new Float32Array(analyser.frequencyBinCount);analyser.getFloatFrequencyData(spectrum);
    let peak = 1;for (let i = 2; i < spectrum.length; i++) if (spectrum[i] > spectrum[peak]) peak = i;
    document.getElementById('media-result').textContent = JSON.stringify({ rate: media.playbackRate, preservesPitch: media.preservesPitch,
      peakHz: peak * context.sampleRate / analyser.fftSize, peakDb: spectrum[peak], expectedHz: media.preservesPitch ? 440 : 440 * media.playbackRate }, null, 2);
    graph.disconnect();
  }, 900);
};
window.addEventListener('pagehide', () => { media.pause();context?.close();URL.revokeObjectURL(source); });
