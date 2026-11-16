import { ref, readonly } from 'vue';

// --- Types ---
export type SEType =
  | 'swap' | 'match' | 'chain' | 'clear'
  | 'game_over' | 'item_use' | 'undo' | 'complete';

// --- Settings ---
const KEYS = {
  se: 'vegtab_sound_se',
  bgm: 'vegtab_sound_bgm',
  vibration: 'vegtab_sound_vibration',
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

function respondToPrompt(enableSE: boolean) {
  if (enableSE) ensureAudioContext();
  seEnabled.value = enableSE;
  bgmEnabled.value = false;
  saveBool(KEYS.se, enableSE);
  saveBool(KEYS.bgm, false);
  soundPromptNeeded.value = false;
}

/** User accepts sound — enable SE (BGM stays off by default, user can turn on) */
export function acceptSound() { respondToPrompt(true); }

/** User declines sound — disable both */
export function declineSound() { respondToPrompt(false); }

// --- AudioContext (lazy, resume on user gesture) ---
let ctx: AudioContext | null = null;

/** Create or resume AudioContext. Returns ctx even if suspended — scheduled nodes will queue. */
function getCtx(): AudioContext | null {
  if (!ctx) {
    try { ctx = new AudioContext(); } catch { return null; }
  }
  if (ctx.state === 'suspended') {
    ctx.resume().catch(() => {});
  }
  return ctx;
}

/** Ensure AudioContext is resumed — call from a user gesture handler */
export function ensureAudioContext() { getCtx(); }

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

// Cached noise buffer (reused across playNoise calls)
let noiseBuffer: AudioBuffer | null = null;

function playNoise(duration: number, volume = 0.08) {
  const c = getCtx();
  if (!c) return;
  // Create and cache a 0.5s noise buffer on first use
  if (!noiseBuffer || noiseBuffer.sampleRate !== c.sampleRate) {
    const len = Math.ceil(c.sampleRate * 0.5);
    noiseBuffer = c.createBuffer(1, len, c.sampleRate);
    const data = noiseBuffer.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
  }
  const src = c.createBufferSource();
  src.buffer = noiseBuffer;
  const gain = c.createGain();
  gain.gain.setValueAtTime(volume, c.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.001, c.currentTime + duration);
  src.connect(gain).connect(c.destination);
  src.start(c.currentTime);
  src.stop(c.currentTime + duration);
}

const SE: Record<SEType, () => void> = {
  swap() {
    playTone(330, 0.08, 'square', 0.1);
    setTimeout(() => playTone(440, 0.08, 'square', 0.1), 40);
  },
  match() {
    playTone(880, 0.15, 'sine', 0.12);
    playTone(1320, 0.12, 'sine', 0.08);
  },
  chain() {
    playTone(660, 0.1, 'sine', 0.1);
    setTimeout(() => playTone(880, 0.1, 'sine', 0.1), 60);
    setTimeout(() => playTone(1100, 0.15, 'sine', 0.12), 120);
  },
  clear() {
    playNoise(0.12, 0.06);
    playTone(520, 0.1, 'triangle', 0.06);
  },
  game_over() {
    playTone(440, 0.2, 'triangle', 0.12);
    setTimeout(() => playTone(370, 0.2, 'triangle', 0.12), 150);
    setTimeout(() => playTone(330, 0.3, 'triangle', 0.1), 300);
    setTimeout(() => playTone(262, 0.4, 'triangle', 0.1), 450);
  },
  item_use() {
    playTone(1200, 0.1, 'sine', 0.1);
    setTimeout(() => playTone(1500, 0.08, 'sine', 0.08), 50);
    setTimeout(() => playTone(1800, 0.12, 'sine', 0.06), 100);
  },
  undo() {
    playTone(600, 0.1, 'square', 0.08);
    setTimeout(() => playTone(400, 0.12, 'square', 0.08), 60);
  },
  complete() {
    playTone(523, 0.15, 'sine', 0.12);
    setTimeout(() => playTone(659, 0.15, 'sine', 0.12), 120);
    setTimeout(() => playTone(784, 0.15, 'sine', 0.12), 240);
    setTimeout(() => playTone(1047, 0.3, 'sine', 0.15), 360);
  },
};

export function playSE(name: SEType) {
  if (!seEnabled.value) return;
  if (!ctx || ctx.state === 'suspended') ensureAudioContext();
  try { SE[name](); } catch { /* ignore audio errors */ }
}

// --- BGM ---
let bgmGain: GainNode | null = null;
let bgmTimeout: ReturnType<typeof setTimeout> | null = null;
let bgmPlaying = false;
let bgmScheduledOscs: OscillatorNode[] = [];

// Upbeat melody + chord pattern (BPM ~140, 8th-note = ~214ms)
const BPM = 140;
const EIGHTH = (60 / BPM) * 0.5;

// Section A: upbeat theme
const MELODY_A: [number, number][] = [
  [523, 1], [659, 1], [784, 1], [659, 1],
  [698, 1], [784, 1], [880, 2],
  [784, 1], [659, 1], [523, 1], [659, 1],
  [587, 1], [523, 1], [440, 2],
];
const BASS_A: [number, number][] = [
  [262, 2], [262, 2], [262, 2], [262, 2],
  [349, 2], [349, 2], [349, 2], [349, 2],
  [392, 2], [392, 2], [392, 2], [392, 2],
  [330, 2], [330, 2], [220, 2], [220, 2],
];

// Section B: variation / development
const MELODY_B: [number, number][] = [
  [880, 1], [784, 1], [659, 1], [784, 1],
  [880, 1], [1047, 1], [880, 2],
  [784, 1], [698, 1], [659, 1], [523, 1],
  [587, 2], [523, 2],
];
const BASS_B: [number, number][] = [
  [349, 2], [349, 2], [349, 2], [349, 2],
  [262, 2], [262, 2], [262, 2], [262, 2],
  [392, 2], [392, 2], [392, 2], [392, 2],
  [262, 2], [262, 2], [262, 2], [262, 2],
];

// Full pattern: A → A → B
const BGM_MELODY = [...MELODY_A, ...MELODY_A, ...MELODY_B];
const BGM_BASS = [...BASS_A, ...BASS_A, ...BASS_B];
const BGM_LOOP_DUR = BGM_MELODY.reduce((s, [, d]) => s + d, 0) * EIGHTH;

function scheduleVoice(
  notes: [number, number][],
  oscType: OscillatorType,
  volume: number,
  decayFactor: number,
  startTime: number,
  c: AudioContext,
) {
  let t = startTime;
  for (const [freq, dur] of notes) {
    const osc = c.createOscillator();
    const g = c.createGain();
    osc.type = oscType;
    osc.frequency.value = freq;
    g.gain.setValueAtTime(volume, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur * EIGHTH * decayFactor);
    osc.connect(g).connect(bgmGain!);
    osc.start(t);
    osc.stop(t + dur * EIGHTH);
    bgmScheduledOscs.push(osc);
    t += dur * EIGHTH;
  }
}

function scheduleBgmLoop() {
  if (!bgmPlaying || !bgmGain || !ctx) return;

  const c = ctx;
  const now = c.currentTime;
  const vol = 0.05;

  bgmScheduledOscs = [];
  scheduleVoice(BGM_MELODY, 'square', vol * 0.7, 0.9, now, c);
  scheduleVoice(BGM_BASS, 'triangle', vol, 0.85, now, c);

  bgmTimeout = setTimeout(scheduleBgmLoop, BGM_LOOP_DUR * 1000 - 50);
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
  for (const osc of bgmScheduledOscs) {
    try { osc.stop(0); } catch { /* already stopped */ }
  }
  bgmScheduledOscs = [];
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
