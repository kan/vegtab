import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import { todayLocal } from '@/utils/date';
import { api, register, isAuthenticated } from '@/api/client';

// --- Types ---

export interface PlayRecord {
  seed: number;
  mode: 'limited';
  score: number;
  moves: number;
  playedAt: number;
  playerName: string;
}

// --- Store ---

export const useGameStore = defineStore('game', () => {
  const displayName = ref(loadStr('tomado_display_name', ''));
  const playRecords = ref<PlayRecord[]>(loadJson('tomado_play_records', []));
  const initialized = ref(false);
  // Map: engine seed number → { backendSeedId, shareCode }
  const shareCodeMap = ref<Record<number, { seedId: string; shareCode: string }>>(
    loadJson('tomado_share_codes', {})
  );

  /** Initialize: ensure authenticated and sync with server */
  async function init() {
    if (initialized.value) return;
    try {
      if (!isAuthenticated()) {
        await register();
      }
      await syncProfile();
      initialized.value = true;
    } catch (e) {
      console.warn('Failed to initialize with server, using local data', e);
      initialized.value = true;
    }
  }

  /** Sync local state with server profile */
  async function syncProfile() {
    try {
      const profile = await api<{
        id: string;
        displayName: string | null;
      }>('/api/user/profile');

      if (profile.displayName) displayName.value = profile.displayName;
    } catch {
      // Silently use local data on failure
    }
  }

  async function setDisplayName(name: string) {
    displayName.value = name.slice(0, 20);
    localStorage.setItem('tomado_display_name', displayName.value);
    try {
      await api('/api/user/profile', {
        method: 'PATCH',
        body: JSON.stringify({ displayName: displayName.value || null }),
      });
    } catch {
      // Local update still applied
    }
  }

  const effectiveName = computed(() => displayName.value || 'Anonymous');

  // --- Seeds ---

  function generateDailySeed(dateStr?: string): number {
    const d = dateStr ?? todayLocal();
    let hash = 0;
    for (let i = 0; i < d.length; i++) {
      hash = ((hash << 5) - hash + d.charCodeAt(i)) | 0;
    }
    return Math.abs(hash);
  }

  function isTodaysDailySeed(seed: number): boolean {
    return seed === generateDailySeed(todayLocal());
  }

  function randomSeed(): number {
    return ((Date.now() & 0x7fffffff) ^ (Math.random() * 0x7fffffff)) >>> 0;
  }

  // --- Play records ---

  function addPlayRecord(record: Omit<PlayRecord, 'playedAt' | 'playerName'>) {
    playRecords.value.push({
      ...record,
      playedAt: Date.now(),
      playerName: effectiveName.value,
    });
    saveRecords();
  }

  function getRecordsForSeed(seed: number, mode?: 'limited'): PlayRecord[] {
    return playRecords.value.filter(r =>
      r.seed === seed && (mode === undefined || r.mode === mode)
    );
  }

  function getBestScore(seed: number, mode: 'limited'): number {
    const records = getRecordsForSeed(seed, mode);
    return records.length > 0 ? Math.max(...records.map(r => r.score)) : 0;
  }

  // --- Calendar helpers ---

  function getDailySeeds(year: number, month: number): { date: string; seed: number }[] {
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const result: { date: string; seed: number }[] = [];
    for (let d = 1; d <= daysInMonth; d++) {
      const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      result.push({ date: dateStr, seed: generateDailySeed(dateStr) });
    }
    return result;
  }

  function hasPlayedDaily(dateStr: string): boolean {
    const seed = generateDailySeed(dateStr);
    return playRecords.value.some(r => r.seed === seed);
  }

  // --- Persistence ---

  function saveRecords() {
    localStorage.setItem('tomado_play_records', JSON.stringify(playRecords.value));
  }

  function saveShareCodes() {
    localStorage.setItem('tomado_share_codes', JSON.stringify(shareCodeMap.value));
  }

  /** Cache a share code mapping and persist to localStorage */
  function cacheShareCode(seed: number, seedId: string, shareCode: string) {
    shareCodeMap.value[seed] = { seedId, shareCode };
    saveShareCodes();
  }

  /** Get or create a shareCode for a seed by registering it with the backend */
  const pendingShareCodes = new Map<number, Promise<string | null>>();
  async function getShareCode(seed: number): Promise<string | null> {
    const cached = shareCodeMap.value[seed];
    if (cached) return cached.shareCode;
    const inflight = pendingShareCodes.get(seed);
    if (inflight) return inflight;
    const p = (async () => {
      try {
        const res = await api<{ seedId: string; seedValue: string; shareCode: string }>('/api/seeds/generate', {
          method: 'POST',
          body: JSON.stringify({ seedValue: String(seed) }),
        });
        cacheShareCode(seed, res.seedId, res.shareCode);
        return res.shareCode;
      } catch {
        return null;
      }
    })();
    pendingShareCodes.set(seed, p);
    p.finally(() => pendingShareCodes.delete(seed));
    return p;
  }

  return {
    displayName, effectiveName, setDisplayName,
    playRecords,
    generateDailySeed, randomSeed,
    isTodaysDailySeed,
    addPlayRecord, getRecordsForSeed, getBestScore,
    getDailySeeds, hasPlayedDaily,
    init, syncProfile, initialized,
    getShareCode, cacheShareCode,
  };
});

// --- Helpers ---

function loadStr(key: string, fallback: string): string {
  try {
    return localStorage.getItem(key) ?? fallback;
  } catch {
    return fallback;
  }
}

function loadJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

