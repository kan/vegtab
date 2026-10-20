import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import { formatDateJST, todayJST } from '@/utils/date';
import { api, register, isAuthenticated, showToast } from '@/api/client';
import { setLocalItem } from '@/lib/storage';
import { filterPlayRecords } from '@/lib/legacyData';
import { isBetterResult, type ResultSummary } from '@/lib/bestResult';
// 静的に import する（遅延 import だと、デプロイ後の旧バンドルのタブで旧チャンクが取れず実績の通知が消える）
import { useAchievementStore } from '@/stores/achievements';
import { generateDailySeed } from '@vegtab/engine';
import { type ReplayAction } from '@/stores/puzzle';
import { DEFAULT_DISPLAY_NAME } from '@/utils/constants';

// --- Types ---

export interface PlayRecord {
  seed: number;
  score: number;
  moves: number;
  playedAt: number;
  playerName: string;
  isCleared?: boolean;
  /** クリアした時点のその日の累計プレイ時間（ミリ秒）。順位の 2 つ目の基準。未クリアと、時間を順位に入れる前の記録は null か未設定 */
  clearTimeMs?: number | null;
  generatedItemTypes?: string[];
  replayLog?: ReplayAction[];
}

// --- Store ---

export const useGameStore = defineStore('game', () => {
  const displayName = ref(loadStr('vegtab_display_name', ''));
  const playRecords = ref<PlayRecord[]>(loadPlayRecords());
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

  // seed → the best result stored on the server (from /api/scores/my)
  const serverBest = new Map<number, ResultSummary>();

  function toSummary(r: PlayRecord): ResultSummary {
    return { isCleared: r.isCleared ?? false, moves: r.moves, timeMs: r.clearTimeMs ?? null };
  }

  /** サーバーのベストがこの記録以上なので、送っても置き換わらない（失敗だけの日に後からクリアした記録は送る） */
  function isCoveredByServer(r: PlayRecord): boolean {
    const best = serverBest.get(r.seed);
    return !!best && !isBetterResult(toSummary(r), best);
  }

  /** Fetch user's scores from server and merge into local playRecords */
  async function syncScoresFromServer() {
    try {
      const data = await api<{
        scores: Array<{
          seedValue: number;
          moveCount: number;
          score: number;
          isCleared: boolean;
          clearTimeMs: number | null;
          createdAt: string;
        }>;
      }>('/api/scores/my');

      serverBest.clear();
      const localSeeds = new Set(playRecords.value.map(r => r.seed));
      for (const s of data.scores) {
        serverBest.set(s.seedValue, { isCleared: s.isCleared, moves: s.moveCount, timeMs: s.clearTimeMs });
        if (localSeeds.has(s.seedValue)) continue;

        playRecords.value.push({
          seed: s.seedValue,
          score: s.score,
          moves: s.moveCount,
          isCleared: s.isCleared,
          clearTimeMs: s.clearTimeMs,
          playedAt: new Date(s.createdAt + 'Z').getTime(),
          playerName: effectiveName.value,
        });
      }
      // サーバーのベストを超えない記録と、再送の期間を過ぎた日の記録は再送しないので、容量を食う replayLog はもう要らない
      for (const r of playRecords.value) {
        if (r.replayLog && (isCoveredByServer(r) || findDailyDate(r.seed) === null)) {
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
      mode: 'clear',
      // 時間はサーバーで検証できない自己申告の値（SPEC §5.3）
      clearTimeMs: record.clearTimeMs ?? null,
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
      if (isCoveredByServer(r) || !hasReplayLog(r)) return false;
      return findDailyDate(r.seed) !== null;
    });
    if (pending.length === 0) return;

    const results = await Promise.allSettled(pending.map(async (record) => {
      const date = findDailyDate(record.seed)!;
      const res = await api<{ scoreId: string; shareCode: string; newAchievements: string[] }>('/api/scores', {
        method: 'POST',
        body: JSON.stringify(buildScorePayload(record, date)),
      });
      serverBest.set(record.seed, toSummary(record));
      handleScoreResponse(res, record.seed);
      delete record.replayLog;
    }));
    // Silently ignore failures — will retry on next init
    if (results.some(r => r.status === 'fulfilled')) saveRecords();
  }

  function getRecordsForSeed(seed: number): PlayRecord[] {
    return playRecords.value.filter(r => r.seed === seed);
  }

  /** seed → クリアした記録の最少手数（カレンダーの各セルから引くので、記録が変わったときだけ作り直す） */
  const bestMovesBySeed = computed(() => {
    const map = new Map<number, number>();
    for (const r of playRecords.value) {
      if (!r.isCleared) continue;
      const best = map.get(r.seed);
      if (best === undefined || r.moves < best) map.set(r.seed, r.moves);
    }
    return map;
  });

  /** クリアした記録のうち最少の手数。クリアした記録がなければ 0 */
  function getBestMoves(seed: number): number {
    return bestMovesBySeed.value.get(seed) ?? 0;
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
    addPlayRecord, getRecordsForSeed, getBestMoves,
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

/** 撤去したモード（Sprint / Survival / Cascade）の記録は読み込まない（次の保存で消える） */
function loadPlayRecords(): PlayRecord[] {
  return filterPlayRecords<PlayRecord>(loadJson<unknown>('vegtab_play_records', []));
}

function loadJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}
