import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import { formatDateJST, todayJST } from '@/utils/date';
import { api, register, isAuthenticated, showToast } from '@/api/client';
import { setLocalItem } from '@/lib/storage';
// 静的に import する（遅延 import だと、デプロイ後の旧バンドルのタブで旧チャンクが取れず実績の通知が消える）
import { useAchievementStore } from '@/stores/achievements';
import { generateDailySeed } from '@vegtab/engine';
import { type ReplayAction } from '@/stores/puzzle';
import { DEFAULT_DISPLAY_NAME } from '@/utils/constants';

// --- Types ---

export type GameMode = 'sprint' | 'clear' | 'survival' | 'cascade';

export interface PlayRecord {
  seed: number;
  mode: GameMode;
  score: number;
  moves: number;
  playedAt: number;
  playerName: string;
  isCleared?: boolean;
  moveLimit?: number;
  maxChain?: number;
  cascadePoints?: number;
  generatedItemTypes?: string[];
  replayLog?: ReplayAction[];
}

// --- Store ---

export const useGameStore = defineStore('game', () => {
  const displayName = ref(loadStr('vegtab_display_name', ''));
  const playRecords = ref<PlayRecord[]>(loadJson('vegtab_play_records', []));
  const initialized = ref(false);
  // Cache: engine seed number → shareCode (populated from score submission response)
  const shareCodeCache = ref<Record<number, string>>(
    loadJson('vegtab_share_codes_v2', {})
  );

  /** Initialize: ensure authenticated and sync with server */
  async function init() {
    if (initialized.value) return;
    try {
      if (!isAuthenticated()) {
        await register();
      }
      await Promise.all([syncProfile(), syncScoresFromServer(), useAchievementStore().fetchAchievements()]);
      initialized.value = true;
      // After sync, try to submit any local scores that were never sent to backend
      resubmitUnsentScores();
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

  // Track which seed:mode combos are known to exist on the server
  const serverScoreKeys = new Set<string>();

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

      serverScoreKeys.clear();
      const localKeys = new Set(
        playRecords.value.map(r => `${r.seed}:${r.mode}`),
      );
      for (const s of data.scores) {
        serverScoreKeys.add(`${s.seedValue}:${s.mode}`);
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
      // サーバーに記録のある seed×mode と、再送の期間を過ぎた日の記録は再送しないので、容量を食う replayLog はもう要らない
      for (const r of playRecords.value) {
        if (r.replayLog && (serverScoreKeys.has(`${r.seed}:${r.mode}`) || findDailyDate(r.seed) === null)) {
          delete r.replayLog;
        }
      }
      saveRecords();
    } catch {
      // Silently fail — local data still usable
    }
  }

  async function setDisplayName(name: string) {
    const oldName = effectiveName.value;
    displayName.value = name.slice(0, 20);
    setLocalItem('vegtab_display_name', displayName.value);

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
    return generateDailySeed(dateStr ?? todayJST());
  }

  function isTodaysDailySeed(seed: number): boolean {
    return seed === dailySeed(todayJST());
  }

  function randomSeed(): number {
    return ((Date.now() & 0x7fffffff) ^ (Math.random() * 0x7fffffff)) >>> 0;
  }

  /** Find the date string for a daily seed number, or null if not a daily seed.
   *  Searches today ±1 day first (common case), then up to 60 days back for calendar plays. */
  function findDailyDate(seed: number): string | null {
    const today = new Date();
    // Fast path: today ±1 day (covers timezone edge cases)
    for (let offset = -1; offset <= 1; offset++) {
      const d = new Date(today);
      d.setDate(d.getDate() + offset);
      const dateStr = formatDateJST(d);
      if (generateDailySeed(dateStr) === seed) return dateStr;
    }
    // Extended search for calendar plays (up to 60 days back)
    for (let offset = -2; offset >= -60; offset--) {
      const d = new Date(today);
      d.setDate(d.getDate() + offset);
      const dateStr = formatDateJST(d);
      if (generateDailySeed(dateStr) === seed) return dateStr;
    }
    return null;
  }

  // --- Play records ---

  function addPlayRecord(record: Omit<PlayRecord, 'playedAt' | 'playerName'>) {
    const index = playRecords.value.push({
      ...record,
      playedAt: Date.now(),
      playerName: effectiveName.value,
    }) - 1;
    saveRecords();
    // Submit score to backend (fire-and-forget with offline queue)
    submitScoreToBackend(playRecords.value[index]);
  }

  /** The server re-simulates every result from the replay log, so only inputs are sent */
  function buildScorePayload(record: Omit<PlayRecord, 'playedAt' | 'playerName'>, date: string) {
    return {
      date,
      mode: record.mode,
      moveLimit: record.moveLimit ?? null,
      generatedItemTypes: record.generatedItemTypes ?? [],
      replayLog: record.replayLog,
    };
  }

  /** Legacy records without a replay log are rejected by the server */
  function hasReplayLog(record: Omit<PlayRecord, 'playedAt' | 'playerName'>): boolean {
    return !!record.replayLog?.length;
  }

  function handleScoreResponse(res: { shareCode: string }, seed: number) {
    if (res.shareCode) {
      shareCodeCache.value[seed] = res.shareCode;
      saveShareCodeCache();
    }
  }

  async function submitScoreToBackend(record: PlayRecord) {
    const date = findDailyDate(record.seed);
    if (!date || !hasReplayLog(record)) return;
    try {
      const res = await api<{ scoreId: string | null; shareCode: string; newAchievements: string[]; pastDate?: boolean; verifiedScore?: number; verifiedMoveCount?: number }>('/api/scores', {
        method: 'POST',
        body: JSON.stringify(buildScorePayload(record, date)),
        offlineQueue: true,
      });
      handleScoreResponse(res, record.seed);
      // サーバーが受け付けた記録は再送しないので、容量を食う replayLog を落とす
      delete record.replayLog;
      // Update local record with server-verified score
      if (res.verifiedScore !== undefined) {
        record.score = res.verifiedScore;
        if (res.verifiedMoveCount !== undefined) record.moves = res.verifiedMoveCount;
      }
      saveRecords();
      if (res.pastDate) {
        showToast('info', 'toast.pastDateNoRanking');
        return;
      }
      if (res.newAchievements?.length > 0) {
        useAchievementStore().handleNewAchievements(res.newAchievements);
      }
    } catch {
      // Error already handled by api() (toast shown, or queued offline)
    }
  }

  /** Re-submit local scores that are missing from the server (e.g., due to past findDailyDate bug). */
  async function resubmitUnsentScores() {
    const pending = playRecords.value.filter(r => {
      if (serverScoreKeys.has(`${r.seed}:${r.mode}`) || !hasReplayLog(r)) return false;
      return findDailyDate(r.seed) !== null;
    });
    if (pending.length === 0) return;

    const results = await Promise.allSettled(pending.map(async (record) => {
      const date = findDailyDate(record.seed)!;
      const res = await api<{ scoreId: string; shareCode: string; newAchievements: string[] }>('/api/scores', {
        method: 'POST',
        body: JSON.stringify(buildScorePayload(record, date)),
      });
      serverScoreKeys.add(`${record.seed}:${record.mode}`);
      handleScoreResponse(res, record.seed);
      delete record.replayLog;
    }));
    // Silently ignore failures — will retry on next init
    if (results.some(r => r.status === 'fulfilled')) saveRecords();
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
    if (mode === 'clear') {
      const clearedRecords = records.filter(r => r.isCleared);
      return clearedRecords.length > 0 ? Math.min(...clearedRecords.map(r => r.moves)) : 0;
    }
    if (mode === 'survival') {
      return Math.max(...records.map(r => r.moves));
    }
    return 0;
  }

  function getBestMaxChain(seed: number): number {
    const records = getRecordsForSeed(seed, 'cascade');
    if (records.length === 0) return 0;
    return Math.max(...records.map(r => r.maxChain ?? 0));
  }

  function getBestCascadePoints(seed: number): number {
    const records = getRecordsForSeed(seed, 'cascade');
    if (records.length === 0) return 0;
    return Math.max(...records.map(r => r.cascadePoints ?? 0));
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
    setLocalItem('vegtab_play_records', JSON.stringify(playRecords.value));
  }

  function saveShareCodeCache() {
    setLocalItem('vegtab_share_codes_v2', JSON.stringify(shareCodeCache.value));
  }

  /** Reset local state after account transfer, then resync from server */
  async function resetAfterTransfer(newDisplayName: string | null) {
    displayName.value = newDisplayName ?? '';
    setLocalItem('vegtab_display_name', displayName.value);
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
    addPlayRecord, getRecordsForSeed, getBestScore, getBestMoves, getBestMaxChain, getBestCascadePoints,
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
