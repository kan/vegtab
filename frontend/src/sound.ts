import { ref, readonly, type Ref } from 'vue';

// --- Types ---
export type SEType =
  | 'swap' | 'match' | 'chain' | 'clear'
  | 'game_over' | 'item_use' | 'undo' | 'complete';

// --- Settings ---
const KEYS = {
  se: 'tomado_sound_se',
  bgm: 'tomado_sound_bgm',
  vibration: 'tomado_sound_vibration',
} as const;

const seEnabled = ref(false);
const bgmEnabled = ref(false);
const vibrationEnabled = ref(true);
const soundPromptNeeded = ref(false);

function hasKey(key: string): boolean {
  try { return localStorage.getItem(key) !== null; } catch { return false; }
}

function loadBool(key: string, fallback: boolean): boolean {
  try {
    const v = localStorage.getItem(key);
    if (v === '1') return true;
    if (v === '0') return false;
  } catch { /* ignore */ }
  return fallback;
}

function saveBool(key: string, v: boolean) {
  try { localStorage.setItem(key, v ? '1' : '0'); } catch { /* ignore */ }
}

export function initSound() {
  vibrationEnabled.value = loadBool(KEYS.vibration, true);
  // If SE key has never been set, user hasn't chosen yet → show prompt
  if (!hasKey(KEYS.se)) {
    soundPromptNeeded.value = true;
    seEnabled.value = false;
    bgmEnabled.value = false;
  } else {
    soundPromptNeeded.value = false;
    seEnabled.value = loadBool(KEYS.se, true);
    bgmEnabled.value = loadBool(KEYS.bgm, false);
  }
}

/** User accepts sound — enable SE (BGM stays off by default, user can turn on) */
export function acceptSound() {
  ensureAudioContext();
  seEnabled.value = true;
  bgmEnabled.value = false;
  saveBool(KEYS.se, true);
  saveBool(KEYS.bgm, false);
  soundPromptNeeded.value = false;
}

/** User declines sound — disable both */
export function declineSound() {
  seEnabled.value = false;
  bgmEnabled.value = false;
  saveBool(KEYS.se, false);
  saveBool(KEYS.bgm, false);
  soundPromptNeeded.value = false;
}

// --- AudioContext (lazy, resume on user gesture) ---
let ctx: AudioContext | null = null;

function getCtx(): AudioContext | null {
  if (!ctx) {
    try { ctx = new AudioContext(); } catch { return null; }
  }
  if (ctx.state === 'suspended') {
    ctx.resume().catch(() => {});
  }
  return ctx.state === 'running' ? ctx : null;
}

/** Ensure AudioContext is resumed — call from a user gesture handler */
export function ensureAudioContext() {
  if (!ctx) {
    try { ctx = new AudioContext(); } catch { return; }
  }
  if (ctx.state === 'suspended') {
    ctx.resume().catch(() => {});
  }
}

// --- SE Synthesis ---

function playTone(
  freq: number,
  duration: number,
  type: OscillatorType = 'square',
  volume = 0.15,
  detune = 0,
) {
  const c = getCtx();
  if (!c) return;
  const osc = c.createOscillator();
  const gain = c.createGain();
  osc.type = type;
  osc.frequency.value = freq;
  osc.detune.value = detune;
  gain.gain.setValueAtTime(volume, c.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.001, c.currentTime + duration);
  osc.connect(gain).connect(c.destination);
  osc.start(c.currentTime);
  osc.stop(c.currentTime + duration);
}

function playNoise(duration: number, volume = 0.08) {
  const c = getCtx();
  if (!c) return;
  const bufferSize = c.sampleRate * duration;
  const buffer = c.createBuffer(1, bufferSize, c.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < bufferSize; i++) data[i] = Math.random() * 2 - 1;
  const src = c.createBufferSource();
  src.buffer = buffer;
  const gain = c.createGain();
  gain.gain.setValueAtTime(volume, c.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.001, c.currentTime + duration);
  src.connect(gain).connect(c.destination);
  src.start();
}

const SE: Record<SEType, () => void> = {
  swap() {
    // Quick two-note slide (low→high)
    playTone(330, 0.08, 'square', 0.1);
    setTimeout(() => playTone(440, 0.08, 'square', 0.1), 40);
  },
  match() {
    // Bright ping
    playTone(880, 0.15, 'sine', 0.12);
    playTone(1320, 0.12, 'sine', 0.08);
  },
  chain() {
    // Rising arpeggio
    playTone(660, 0.1, 'sine', 0.1);
    setTimeout(() => playTone(880, 0.1, 'sine', 0.1), 60);
    setTimeout(() => playTone(1100, 0.15, 'sine', 0.12), 120);
  },
  clear() {
    // Soft whoosh
    playNoise(0.12, 0.06);
    playTone(520, 0.1, 'triangle', 0.06);
  },
  game_over() {
    // Descending sad tones
    playTone(440, 0.2, 'triangle', 0.12);
    setTimeout(() => playTone(370, 0.2, 'triangle', 0.12), 150);
    setTimeout(() => playTone(330, 0.3, 'triangle', 0.1), 300);
    setTimeout(() => playTone(262, 0.4, 'triangle', 0.1), 450);
  },
  item_use() {
    // Sparkle effect
    playTone(1200, 0.1, 'sine', 0.1);
    setTimeout(() => playTone(1500, 0.08, 'sine', 0.08), 50);
    setTimeout(() => playTone(1800, 0.12, 'sine', 0.06), 100);
  },
  undo() {
    // Reverse swoosh (high→low)
    playTone(600, 0.1, 'square', 0.08);
    setTimeout(() => playTone(400, 0.12, 'square', 0.08), 60);
  },
  complete() {
    // Triumphant fanfare
    playTone(523, 0.15, 'sine', 0.12);
    setTimeout(() => playTone(659, 0.15, 'sine', 0.12), 120);
    setTimeout(() => playTone(784, 0.15, 'sine', 0.12), 240);
    setTimeout(() => playTone(1047, 0.3, 'sine', 0.15), 360);
  },
};

export function playSE(name: SEType) {
  if (!seEnabled.value) return;
  ensureAudioContext();
  try { SE[name](); } catch { /* ignore audio errors */ }
}

// --- BGM ---
let bgmGain: GainNode | null = null;
let bgmTimeout: ReturnType<typeof setTimeout> | null = null;
let bgmPlaying = false;

// Upbeat melody + chord pattern (BPM ~140, 8th-note = ~214ms)
const BPM = 140;
const EIGHTH = (60 / BPM) * 0.5; // ~0.214s

// Section A: upbeat theme
const MELODY_A: [number, number][] = [
  [523, 1], [659, 1], [784, 1], [659, 1],   // C E G E
  [698, 1], [784, 1], [880, 2],              // F G A—
  [784, 1], [659, 1], [523, 1], [659, 1],   // G E C E
  [587, 1], [523, 1], [440, 2],              // D C A—
];
const BASS_A: [number, number][] = [
  [262, 2], [262, 2], [262, 2], [262, 2],   // C
  [349, 2], [349, 2], [349, 2], [349, 2],   // F
  [392, 2], [392, 2], [392, 2], [392, 2],   // G
  [330, 2], [330, 2], [220, 2], [220, 2],   // E, A
];

// Section B: variation / development
const MELODY_B: [number, number][] = [
  [880, 1], [784, 1], [659, 1], [784, 1],   // A G E G
  [880, 1], [1047, 1], [880, 2],             // A C' A—
  [784, 1], [698, 1], [659, 1], [523, 1],   // G F E C
  [587, 2], [523, 2],                         // D— C—
];
const BASS_B: [number, number][] = [
  [349, 2], [349, 2], [349, 2], [349, 2],   // F
  [262, 2], [262, 2], [262, 2], [262, 2],   // C
  [392, 2], [392, 2], [392, 2], [392, 2],   // G
  [262, 2], [262, 2], [262, 2], [262, 2],   // C
];

// Full pattern: A → A → B
const BGM_MELODY = [...MELODY_A, ...MELODY_A, ...MELODY_B];
const BGM_BASS = [...BASS_A, ...BASS_A, ...BASS_B];

function scheduleBgmLoop() {
  if (!bgmPlaying || !bgmGain || !ctx) return;

  const c = ctx;
  const now = c.currentTime;
  const vol = 0.05;

  // Schedule melody
  let t = now;
  for (const [freq, dur] of BGM_MELODY) {
    const osc = c.createOscillator();
    const g = c.createGain();
    osc.type = 'square';
    osc.frequency.value = freq;
    g.gain.setValueAtTime(vol * 0.7, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur * EIGHTH * 0.9);
    osc.connect(g).connect(bgmGain!);
    osc.start(t);
    osc.stop(t + dur * EIGHTH);
    t += dur * EIGHTH;
  }

  // Schedule bass
  let tb = now;
  for (const [freq, dur] of BGM_BASS) {
    const osc = c.createOscillator();
    const g = c.createGain();
    osc.type = 'triangle';
    osc.frequency.value = freq;
    g.gain.setValueAtTime(vol, tb);
    g.gain.exponentialRampToValueAtTime(0.001, tb + dur * EIGHTH * 0.85);
    osc.connect(g).connect(bgmGain!);
    osc.start(tb);
    osc.stop(tb + dur * EIGHTH);
    tb += dur * EIGHTH;
  }

  // Loop duration
  const loopDur = BGM_MELODY.reduce((s, [, d]) => s + d, 0) * EIGHTH;
  bgmTimeout = setTimeout(scheduleBgmLoop, loopDur * 1000 - 50);
}

export function startBGM() {
  if (!bgmEnabled.value) return;
  stopBGM();
  ensureAudioContext();
  try {
    const c = getCtx();
    if (!c) return;
    bgmGain = c.createGain();
    bgmGain.gain.value = 1;
    bgmGain.connect(c.destination);
    bgmPlaying = true;
    scheduleBgmLoop();
  } catch { /* ignore */ }
}

export function stopBGM() {
  bgmPlaying = false;
  if (bgmTimeout) { clearTimeout(bgmTimeout); bgmTimeout = null; }
  if (bgmGain) {
    try { bgmGain.disconnect(); } catch { /* ignore */ }
    bgmGain = null;
  }
}

// --- Vibration ---

export function vibrate(pattern: number | number[]) {
  if (!vibrationEnabled.value) return;
  try { navigator.vibrate?.(pattern); } catch { /* ignore */ }
}

// --- Composable ---

export function useSound() {
  return {
    seEnabled: readonly(seEnabled),
    bgmEnabled: readonly(bgmEnabled),
    vibrationEnabled: readonly(vibrationEnabled),
    soundPromptNeeded: readonly(soundPromptNeeded),
    acceptSound,
    declineSound,
    toggleSE() {
      seEnabled.value = !seEnabled.value;
      saveBool(KEYS.se, seEnabled.value);
    },
    toggleBGM() {
      bgmEnabled.value = !bgmEnabled.value;
      saveBool(KEYS.bgm, bgmEnabled.value);
      if (bgmEnabled.value) startBGM(); else stopBGM();
    },
    toggleVibration() {
      vibrationEnabled.value = !vibrationEnabled.value;
      saveBool(KEYS.vibration, vibrationEnabled.value);
    },
  };
}
