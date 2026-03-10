import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import { formatDateLocal, todayLocal } from '@/utils/date';
import { api, register, isAuthenticated, showToast } from '@/api/client';
import { generateDailySeed } from '@tomado/engine';
import { DEFAULT_DISPLAY_NAME } from '@/utils/constants';

// --- Types ---

export type GameMode = 'sprint' | 'clear' | 'survival';

export interface PlayRecord {
  seed: number;
  mode: GameMode;
  score: number;
  moves: number;
  playedAt: number;
  playerName: string;
  isCleared?: boolean;
  moveLimit?: number;
}

// --- Store ---

export const useGameStore = defineStore('game', () => {
  const displayName = ref(loadStr('tomado_display_name', ''));
  const playRecords = ref<PlayRecord[]>(loadJson('tomado_play_records', []));
  const initialized = ref(false);
  // Cache: engine seed number → shareCode (populated from score submission response)
  const shareCodeCache = ref<Record<number, string>>(
    loadJson('tomado_share_codes_v2', {})
  );

  /** Initialize: ensure authenticated and sync with server */
  async function init() {
    if (initialized.value) return;
    try {
      if (!isAuthenticated()) {
        await register();
      }
      await Promise.all([syncProfile(), syncScoresFromServer()]);
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

  /** Fetch user's scores from server and merge into local playRecords */
  async function syncScoresFromServer() {
    try {
      const data = await api<{
        scores: Array<{
          seedValue: number;
          mode: GameMode;
          moveLimit: number | null;
          moveCount: number;
          score: number;
          isCleared: boolean;
          createdAt: string;
        }>;
      }>('/api/scores/my');

      const localKeys = new Set(
        playRecords.value.map(r => `${r.seed}:${r.mode}`),
      );
      for (const s of data.scores) {
        if (localKeys.has(`${s.seedValue}:${s.mode}`)) continue;

        playRecords.value.push({
          seed: s.seedValue,
          mode: s.mode,
          score: s.score,
          moves: s.moveCount,
          moveLimit: s.moveLimit ?? undefined,
          isCleared: s.isCleared,
          playedAt: new Date(s.createdAt + 'Z').getTime(),
          playerName: effectiveName.value,
        });
      }
      saveRecords();
    } catch {
      // Silently fail — local data still usable
    }
  }

  async function setDisplayName(name: string) {
    const oldName = effectiveName.value;
    displayName.value = name.slice(0, 20);
    localStorage.setItem('tomado_display_name', displayName.value);

    // Update playerName on existing local records that had the old name
    const newName = effectiveName.value;
    if (oldName !== newName) {
      for (const r of playRecords.value) {
        if (r.playerName === oldName) r.playerName = newName;
      }
      saveRecords();
    }

    try {
      await api('/api/user/profile', {
        method: 'PATCH',
        body: JSON.stringify({ displayName: displayName.value || null }),
      });
    } catch {
      // Local update still applied
    }
  }

  const effectiveName = computed(() => displayName.value || DEFAULT_DISPLAY_NAME);

  // --- Seeds ---

  function dailySeed(dateStr?: string): number {
    return generateDailySeed(dateStr ?? todayLocal());
  }

  function isTodaysDailySeed(seed: number): boolean {
    return seed === dailySeed(todayLocal());
  }

  function randomSeed(): number {
    return ((Date.now() & 0x7fffffff) ^ (Math.random() * 0x7fffffff)) >>> 0;
  }

  /** Find the date string for a daily seed number, or null if not a daily seed */
  function findDailyDate(seed: number): string | null {
    const today = new Date();
    for (let offset = -1; offset <= 1; offset++) {
      const d = new Date(today);
      d.setDate(d.getDate() + offset);
      const dateStr = formatDateLocal(d);
      if (generateDailySeed(dateStr) === seed) return dateStr;
    }
    return null;
  }

  // --- Play records ---

  function addPlayRecord(record: Omit<PlayRecord, 'playedAt' | 'playerName'>) {
    playRecords.value.push({
      ...record,
      playedAt: Date.now(),
      playerName: effectiveName.value,
    });
    saveRecords();
    // Submit score to backend (fire-and-forget with offline queue)
    submitScoreToBackend(record);
  }

  async function submitScoreToBackend(record: Omit<PlayRecord, 'playedAt' | 'playerName'>) {
    const date = findDailyDate(record.seed);
    if (!date) {
      // Not a daily seed — cannot submit
      return;
    }
    try {
      const res = await api<{ scoreId: string; shareCode: string }>('/api/scores', {
        method: 'POST',
        body: JSON.stringify({
          date,
          mode: record.mode,
          moveLimit: record.moveLimit ?? null,
          moveCount: record.moves,
          score: record.score,
          isCleared: record.isCleared ?? false,
          replayLog: [],
        }),
        offlineQueue: true,
      });
      // Cache the shareCode for sharing
      if (res.shareCode) {
        shareCodeCache.value[record.seed] = res.shareCode;
        saveShareCodeCache();
      }
    } catch {
      // Error already handled by api() (toast shown, or queued offline)
    }
  }

  function getRecordsForSeed(seed: number, mode?: GameMode): PlayRecord[] {
    return playRecords.value.filter(r =>
      r.seed === seed && (mode === undefined || r.mode === mode)
    );
  }

  function getBestScore(seed: number, mode: GameMode): number {
    const records = getRecordsForSeed(seed, mode);
    if (records.length === 0) return 0;
    if (mode === 'clear') {
      // Clearモード: 最少手数が最良
      const clearedRecords = records.filter(r => r.score > 0); // score=moveCount for cleared
      return clearedRecords.length > 0 ? Math.min(...clearedRecords.map(r => r.score)) : 0;
    }
    return Math.max(...records.map(r => r.score));
  }

  function getBestMoves(seed: number, mode: GameMode): number {
    const records = getRecordsForSeed(seed, mode);
    if (records.length === 0) return 0;
    if (mode === 'survival') {
      return Math.max(...records.map(r => r.moves));
    }
    return 0;
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

  // --- Share ---

  function getShareCode(seed: number): string | null {
    return shareCodeCache.value[seed] ?? null;
  }

  // --- Persistence ---

  function saveRecords() {
    localStorage.setItem('tomado_play_records', JSON.stringify(playRecords.value));
  }

  function saveShareCodeCache() {
    localStorage.setItem('tomado_share_codes_v2', JSON.stringify(shareCodeCache.value));
  }

  /** Reset local state after account transfer, then resync from server */
  async function resetAfterTransfer(newDisplayName: string | null) {
    displayName.value = newDisplayName ?? '';
    localStorage.setItem('tomado_display_name', displayName.value);
    playRecords.value = [];
    saveRecords();
    shareCodeCache.value = {};
    saveShareCodeCache();
    initialized.value = false;
    // Resync scores from the transferred account
    await syncScoresFromServer();
    initialized.value = true;
  }

  return {
    displayName, effectiveName, setDisplayName,
    playRecords,
    generateDailySeed: dailySeed, randomSeed,
    isTodaysDailySeed,
    addPlayRecord, getRecordsForSeed, getBestScore, getBestMoves,
    getDailySeeds, hasPlayedDaily,
    init, syncProfile, syncScoresFromServer, initialized,
    getShareCode,
    resetAfterTransfer,
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
