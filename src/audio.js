// Original WebAudio music + SFX. Everything goes through a 120 Hz high-pass (no rumble/hum). No samples, no drones.
const HP = 120;
let ctx = null, master = null, musicBus = null, sfxBus = null, noiseBuf = null;
let muted = false; try { muted = localStorage.getItem('sj_muted') === '1'; } catch (e) {}
let timer = null, nextBeat = 0, beatIdx = 0, mode = 'title', playing = false;
let windGain = null, windSrc = null, windFilter = null;

export function isMuted() { return muted; }
export function setMuted(m) { muted = m; try { localStorage.setItem('sj_muted', m ? '1' : '0'); } catch (e) {} if (master) master.gain.setTargetAtTime(m ? 0 : 0.9, ctx.currentTime, 0.02); if (m && window.speechSynthesis) try { speechSynthesis.cancel(); } catch (e) {} }
export function initAudio() {
  if (ctx) { if (ctx.state === 'suspended') ctx.resume(); return; }
  const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return;
  ctx = new AC();
  master = ctx.createGain(); master.gain.value = muted ? 0 : 0.9;
  const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = HP; hp.Q.value = 0.7;
  const comp = ctx.createDynamicsCompressor(); comp.threshold.value = -14; comp.ratio.value = 4;
  master.connect(hp); hp.connect(comp); comp.connect(ctx.destination);
  musicBus = ctx.createGain(); musicBus.gain.value = 0.55; musicBus.connect(master);
  sfxBus = ctx.createGain(); sfxBus.gain.value = 0.9; sfxBus.connect(master);
  noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate); const d = noiseBuf.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
}
const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);
function tone(t, freq, dur, type, vol, bus, opts) {
  opts = opts || {}; if (!ctx) return; if (freq < 130) freq *= 2;           // never below ~130 Hz
  const o = ctx.createOscillator(), g = ctx.createGain(); o.type = type; o.frequency.setValueAtTime(freq, t);
  if (opts.slide) o.frequency.exponentialRampToValueAtTime(Math.max(130, freq * opts.slide), t + dur);
  if (opts.det) o.detune.value = opts.det;
  const a = opts.a || 0.008, r = opts.r || 0.06;
  g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(vol, t + a); g.gain.setValueAtTime(vol, t + Math.max(a, dur - r)); g.gain.exponentialRampToValueAtTime(0.0001, t + dur + 0.02);
  o.connect(g); g.connect(bus || sfxBus); o.start(t); o.stop(t + dur + 0.06);
}
function noise(t, dur, vol, ftype, f0, f1, q, bus) {
  if (!ctx) return; const s = ctx.createBufferSource(); s.buffer = noiseBuf; s.loop = true; const f = ctx.createBiquadFilter(); f.type = ftype; f.frequency.setValueAtTime(f0, t); if (f1) f.frequency.exponentialRampToValueAtTime(f1, t + dur); f.Q.value = q || 0.8;
  const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(vol, t + Math.min(0.03, dur * 0.3)); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  s.connect(f); f.connect(g); g.connect(bus || sfxBus); s.start(t, Math.random()); s.stop(t + dur + 0.05);
}
// ---------------- music: 8 bar loops, bright major key.  title = relaxed 104 bpm; run = driving 132 bpm; fly = soaring
const CHORDS = [[60, 64, 67], [57, 60, 64], [65, 69, 72], [67, 71, 74]];          // C Am F G
const BASS = [48, 45, 53, 43];
const MEL_T = [76, 79, 81, 79, 76, 74, 72, 74,  72, 76, 79, 76, 72, 69, 72, 76,  77, 81, 84, 81, 77, 76, 74, 72,  74, 79, 83, 79, 74, 71, 74, 79];
const MEL_R = [72, 0, 76, 79, 76, 0, 74, 76,  72, 0, 76, 81, 79, 0, 76, 74,  77, 0, 81, 84, 81, 0, 79, 77,  79, 0, 83, 86, 83, 79, 76, 74];
function step() {
  if (!playing) return;
  const bpm = mode === 'title' ? 104 : mode === 'run' ? 134 : mode === 'fly' ? 120 : 112;
  const spb = 60 / bpm, s16 = spb / 4;
  while (nextBeat < ctx.currentTime + 0.25) {
    const i = beatIdx % 128; const bar = (i >> 4) & 7; const chord = CHORDS[(bar >> 1) % 4]; const root = BASS[(bar >> 1) % 4]; const sub = i % 16; const t = nextBeat;
    const vm = musicBus;
    if (mode === 'title' || mode === 'fly' || mode === 'win') {
      if (sub % 2 === 0) { const n = chord[(sub / 2) % 3]; tone(t, mtof(n + 12), s16 * 1.8, 'triangle', 0.14, vm, { a: 0.01, r: 0.08 }); }   // arp
      if (sub === 0 || sub === 8) tone(t, mtof(root + 12), s16 * 5, 'triangle', 0.22, vm, { a: 0.01, r: 0.1 });
      if (sub % 4 === 0) { const mi = (i >> 2) % 32; const n = MEL_T[mi]; tone(t, mtof(n), s16 * 3.6, 'square', mode === 'win' ? 0.07 : 0.055, vm, { a: 0.012, r: 0.1, det: 6 }); tone(t, mtof(n), s16 * 3.6, 'triangle', 0.1, vm, { a: 0.012 }); }
      if (sub === 0 || sub === 8) noise(t, 0.09, 0.07, 'highpass', 5000, 3000, 0.7, vm);
      if (sub === 4 || sub === 12) { noise(t, 0.08, 0.1, 'bandpass', 1800, 1200, 1.2, vm); }
      if (mode === 'win' && sub % 4 === 2) noise(t, 0.05, 0.05, 'highpass', 7000, 6000, 0.7, vm);
    } else if (mode === 'run') {
      if (sub % 4 === 0) { tone(t, 150, 0.12, 'sine', 0.35, vm, { slide: 0.55, a: 0.003, r: 0.06 }); }       // kick (stays >= 130Hz via slide floor)
      if (sub === 4 || sub === 12) noise(t, 0.1, 0.13, 'bandpass', 2200, 1500, 1.3, vm);
      if (sub % 2 === 0) noise(t, 0.04, 0.06, 'highpass', 7000, 6000, 0.7, vm);
      if (sub % 2 === 0) { const n = chord[(sub / 2) % 3] + 12; tone(t, mtof(n), s16 * 1.4, 'square', 0.04, vm, { a: 0.004, r: 0.05 }); }
      if (sub === 0 || sub === 6 || sub === 10) tone(t, mtof(root + 12), s16 * 3, 'sawtooth', 0.09, vm, { a: 0.004, r: 0.06 });
      const mi = (i >> 1) % 32; const n = MEL_R[mi]; if (sub % 2 === 0 && n) tone(t, mtof(n), s16 * 1.8, 'square', 0.055, vm, { a: 0.006, r: 0.06, det: 5 });
    }
    nextBeat += s16; beatIdx++;
  }
}
export function music(m) {
  if (!ctx) return; mode = m; if (!playing) { playing = true; nextBeat = ctx.currentTime + 0.05; beatIdx = 0; timer = setInterval(step, 60); }
}
export function musicStop() { playing = false; if (timer) { clearInterval(timer); timer = null; } stopWind(); }
// ---------------- SFX
export function sfx(name, arg) {
  if (!ctx || muted) return; const t = ctx.currentTime + 0.005;
  switch (name) {
    case 'tap': tone(t, 880, 0.08, 'square', 0.12, sfxBus, { r: 0.04 }); break;
    case 'perfect': [72, 76, 79, 84, 88].forEach((n, i) => tone(t + i * 0.06, mtof(n), 0.16, 'triangle', 0.2, sfxBus)); noise(t, 0.3, 0.08, 'highpass', 6000, 9000, 0.7); break;
    case 'great': [72, 76, 79, 84].forEach((n, i) => tone(t + i * 0.07, mtof(n), 0.14, 'triangle', 0.18, sfxBus)); break;
    case 'good': [72, 77].forEach((n, i) => tone(t + i * 0.08, mtof(n), 0.14, 'triangle', 0.16, sfxBus)); break;
    case 'ok': tone(t, 330, 0.16, 'triangle', 0.14, sfxBus, { slide: 0.7 }); break;
    case 'beep': tone(t, 660, 0.09, 'square', 0.1, sfxBus); break;
    case 'go': tone(t, 523, 0.1, 'square', 0.13, sfxBus); tone(t + 0.1, 784, 0.22, 'square', 0.13, sfxBus); break;
    case 'whoosh': noise(t, 0.7, 0.28, 'bandpass', 700, 3500, 0.9); break;
    case 'launch': noise(t, 0.5, 0.3, 'bandpass', 500, 4000, 0.8); tone(t, 220, 0.4, 'sawtooth', 0.1, sfxBus, { slide: 3 }); break;
    case 'land': noise(t, 0.35, 0.5, 'lowpass', 1800, 300, 0.8); noise(t, 0.4, 0.25, 'bandpass', 2500, 1800, 0.6); tone(t, 180, 0.2, 'sine', 0.3, sfxBus, { slide: 0.6 }); break;
    case 'skid': noise(t, 1.1, 0.22, 'bandpass', 3500, 1200, 0.9); break;
    case 'cheer': for (let k = 0; k < 6; k++) { const tt = t + k * 0.07; noise(tt, 1.6, 0.1, 'bandpass', 900 + k * 220, 1500 + k * 200, 1.4); tone(tt, 330 + k * 70, 0.9, 'triangle', 0.025, sfxBus, { slide: 1.25, a: 0.2, r: 0.5 }); } break;
    case 'fanfare': { const seq = [[67, 0], [72, 0.14], [76, 0.28], [79, 0.42], [84, 0.64]]; seq.forEach(([n, d], i) => { tone(t + d, mtof(n), i === 4 ? 0.8 : 0.18, 'sawtooth', 0.09, sfxBus, { a: 0.01, r: 0.1 }); tone(t + d, mtof(n + 12), i === 4 ? 0.8 : 0.18, 'square', 0.04, sfxBus); }); } break;
    case 'record': [72, 76, 79, 84, 79, 84, 88, 91].forEach((n, i) => tone(t + i * 0.09, mtof(n), 0.2, 'square', 0.1, sfxBus)); break;
    case 'unlock': [76, 83, 88].forEach((n, i) => tone(t + i * 0.1, mtof(n), 0.22, 'triangle', 0.18, sfxBus)); break;
    case 'click': tone(t, 700, 0.05, 'square', 0.08, sfxBus); break;
  }
}
export function startWind() {
  if (!ctx || windSrc) return; windSrc = ctx.createBufferSource(); windSrc.buffer = noiseBuf; windSrc.loop = true;
  windFilter = ctx.createBiquadFilter(); windFilter.type = 'bandpass'; windFilter.frequency.value = 1800; windFilter.Q.value = 0.6;
  windGain = ctx.createGain(); windGain.gain.value = 0; windSrc.connect(windFilter); windFilter.connect(windGain); windGain.connect(sfxBus); windSrc.start();
}
export function windLevel(v, gust) { if (!windGain) return; windGain.gain.setTargetAtTime(muted ? 0 : v * (0.6 + 0.4 * gust), ctx.currentTime, 0.1); windFilter.frequency.setTargetAtTime(1200 + v * 3200, ctx.currentTime, 0.2); }
export function stopWind() { if (windSrc) { try { windSrc.stop(); } catch (e) {} windSrc = null; windGain = null; } }
// ---------------- speech
export function speak(text) {
  if (muted || !('speechSynthesis' in window)) return;
  try { speechSynthesis.cancel(); const u = new SpeechSynthesisUtterance(text); u.rate = 1.02; u.pitch = 1.15; u.volume = 1; const vs = speechSynthesis.getVoices(); const v = vs.find((x) => /en[-_]US/i.test(x.lang) && /(samantha|female|google us)/i.test(x.name)) || vs.find((x) => /^en/i.test(x.lang)); if (v) u.voice = v; speechSynthesis.speak(u); } catch (e) {}
}
export function unlockSpeech() { try { if ('speechSynthesis' in window) { const u = new SpeechSynthesisUtterance(' '); u.volume = 0; speechSynthesis.speak(u); } } catch (e) {} }
