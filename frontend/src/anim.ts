import { ref, computed, readonly, watch } from 'vue';

// --- Settings ---
const KEY = 'tomado_anim_speed';
type AnimSpeed = 1 | 2 | 3 | 4;
const SPEEDS: readonly AnimSpeed[] = [1, 2, 3, 4];

const animSpeed = ref<AnimSpeed>(1);

function loadSpeed(): AnimSpeed {
  try {
    const v = Number(localStorage.getItem(KEY));
    if (SPEEDS.includes(v as AnimSpeed)) return v as AnimSpeed;
  } catch { /* ignore */ }
  return 1;
}

function saveSpeed(v: AnimSpeed) {
  try { localStorage.setItem(KEY, String(v)); } catch { /* ignore */ }
}

export function initAnim() {
  animSpeed.value = loadSpeed();
}

function cycleSpeed() {
  const i = SPEEDS.indexOf(animSpeed.value);
  const next = SPEEDS[(i + 1) % SPEEDS.length];
  animSpeed.value = next;
  saveSpeed(next);
}

// Base timing values (ms) at 1x speed
const BASE = {
  SWAP: 150,
  MATCH_SHOW: 350,
  CLEAR: 250,
  DROP: 300,
  CELL_SWEEP_INTERVAL: 40,
  ITEM_CLEAR: 150,
  ITEM_CLEAR_WAIT: 250,  // ITEM_CLEAR + 100ms buffer
  ITEM_CLEAR_WAIT_LONG: 350,  // ITEM_CLEAR + 200ms buffer
} as const;

/** Speed-adjusted animation timings (reactive) */
const ANIM = computed(() => {
  const s = animSpeed.value;
  return {
    SWAP: BASE.SWAP / s,
    MATCH_SHOW: BASE.MATCH_SHOW / s,
    CLEAR: BASE.CLEAR / s,
    DROP: BASE.DROP / s,
    CELL_SWEEP_INTERVAL: BASE.CELL_SWEEP_INTERVAL / s,
    ITEM_CLEAR: BASE.ITEM_CLEAR / s,
    ITEM_CLEAR_WAIT: BASE.ITEM_CLEAR_WAIT / s,
    ITEM_CLEAR_WAIT_LONG: BASE.ITEM_CLEAR_WAIT_LONG / s,
  };
});

/** Scale an arbitrary duration (ms) by the current speed */
function scaled(ms: number): number {
  return ms / animSpeed.value;
}

watch(animSpeed, (v) => {
  document.documentElement.style.setProperty('--anim-duration-factor', String(v));
}, { immediate: true });

// --- Composable ---
export function useAnim() {
  return {
    animSpeed: readonly(animSpeed),
    ANIM,
    cycleSpeed,
    scaled,
  };
}
