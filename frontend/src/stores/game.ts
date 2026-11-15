import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import { daysOfMonth, nextMonth, shiftDateStr, todayJST } from '@/utils/date';
import { api, apiErrorCode, flushOfflineQueue, showToast, ApiError } from '@/api/client';
import { getUserId, onIdChange, rememberKanGameName, startId } from '@/api/id';
import { setLocalItem } from '@/lib/storage';
import { filterPlayRecords } from '@/lib/legacyData';
import { isBetterResult, type ResultSummary } from '@/lib/bestResult';
// 静的に import する（遅延 import だと、デプロイ後の旧バンドルのタブで旧チャンクが取れず実績の通知が消える）
import { useAchievementStore } from '@/stores/achievements';
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

/** What became of setting the name (registerName on kan-game.app, then the consent here) */
export type NameResult = 'ok' | 'name_taken' | 'invalid_name' | 'failed';

/** The result of handing an old vegtab.app account over (POST /api/legacy/claim) */
export type HandoffResult =
  | { ok: true; name: 'registered' | 'kept' | 'taken' | 'invalid' | 'none' }
  | { ok: false; reason: 'invalid' | 'failed' };

export const useGameStore = defineStore('game', () => {
  /** The name published in the rankings (kan-game.app name with consent here), or '' before that */
  const displayName = ref(loadStr('vegtab_display_name', ''));
  const playRecords = ref<PlayRecord[]>(loadPlayRecords());
  const initialized = ref(false);
  // Cache: engine seed number → shareCode (populated from score submission response)
  const shareCodeCache = ref<Record<number, string>>(
    loadJson('vegtab_share_codes_v2', {})
  );

  let initializing: Promise<void> | undefined;

  /** Initialize once: get the kan-game.app ID and sync with the server. Without an ID, local data only */
  function init(): Promise<void> {
    initializing ??= (async () => {
      await startId();
      if (getUserId()) await syncWithServer();
      initialized.value = true;
    })();
    return initializing;
  }

  async function syncWithServer() {
    try {
      await Promise.all([
        syncProfile(),
        // Matching the records to their days (findDailyDate) needs the seeds
        loadRecentSeeds().then(syncScoresFromServer),
        useAchievementStore().fetchAchievements(),
      ]);
      // After sync, try to submit any local scores that were never sent to backend
      resubmitUnsentScores();
    } catch (e) {
      console.warn('Failed to sync with server, using local data', e);
    }
  }

  /** Sync local state with server profile */
  async function syncProfile() {
    try {
      const profile = await api<{ displayName: string | null }>('/api/user/profile');
      setLocalName(profile.displayName ?? '');
    } catch {
      // Silently use local data on failure
    }
  }

  /**
   * The device moved to another ID (a transfer code, a withdrawal): the records shown are the new
   * ID's, from the server. A device getting its first ID keeps what it played offline and syncs
   * (init syncs by itself if it is still running)
   */
  onIdChange(async (newId, previous) => {
    if (!previous) {
      if (newId && initialized.value) {
        // Scores played without an ID wait in the offline queue
        flushOfflineQueue();
        await syncWithServer();
      }
      return;
    }
    setLocalName('');
    playRecords.value = [];
    saveRecords();
    shareCodeCache.value = {};
    saveShareCodeCache();
    serverBest.clear();
    useAchievementStore().reset();
    if (newId) await syncWithServer();
  });

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
        // 日の分からない記録は、seed を受け取れていないだけかもしれないので、受け取れたときだけ落とす
        if (r.replayLog && (isCoveredByServer(r) || (recentSeedsLoaded && findDailyDate(r.seed) === null))) {
          delete r.replayLog;
        }
      }
      saveRecords();
    } catch {
      // Silently fail — local data still usable
    }
  }

  function setLocalName(name: string) {
    const oldName = effectiveName.value;
    displayName.value = name;
    setLocalItem('vegtab_display_name', name);
    // The published name is the ID's kan-game.app name
    if (name) rememberKanGameName(name);

    // Update playerName on existing local records that had the old name
    const newName = effectiveName.value;
    if (oldName !== newName) {
      for (const r of playRecords.value) {
        if (r.playerName === oldName) r.playerName = newName;
      }
      saveRecords();
    }
  }

  /**
   * Registers the kan-game.app name and consents to publish it in the rankings. Names are shared by
   * all kan-game.app games and cannot change: an ID already named keeps its name
   */
  async function setDisplayName(name: string): Promise<NameResult> {
    try {
      const res = await api<{ displayName: string }>('/api/user/profile', {
        method: 'POST',
        body: JSON.stringify({ displayName: name, consent: true }),
      });
      setLocalName(res.displayName);
      return 'ok';
    } catch (e) {
      const code = apiErrorCode(e);
      return code === 'name_taken' || code === 'invalid_name' ? code : 'failed';
    }
  }

  /** Moves the records of an old vegtab.app account onto this ID (the token came in the URL from the old URL) */
  async function claimHandoff(token: string): Promise<HandoffResult> {
    try {
      const res = await api<{ name: Extract<HandoffResult, { ok: true }>['name'] }>(
        '/api/legacy/claim', { method: 'POST', body: JSON.stringify({ token }) },
      );
      await syncWithServer();
      return { ok: true, ...res };
    } catch (e) {
      return { ok: false, reason: e instanceof ApiError && e.status === 400 ? 'invalid' : 'failed' };
    }
  }

  const effectiveName = computed(() => displayName.value || DEFAULT_DISPLAY_NAME);

  // --- Seeds ---
  // 日ごとの seed は backend が secret から作り、その日になってから配る（#116）。端末では計算できないので、
  // 受け取った値を date → seed で覚えておき、オフラインでも一度受け取った日は遊べるようにする

  /** スコアを送れる過去の日数（backend の isDateNearToday と同じ） */
  const SUBMITTABLE_DAYS = 60;

  const dailySeeds = ref<Record<string, number>>(loadJson('vegtab_daily_seeds', {}));
  /** このセッションで、スコアを送れる期間の seed を受け取れた */
  let recentSeedsLoaded = false;

  function rememberDailySeeds(entries: Array<{ date: string; seedValue: string }>) {
    let changed = false;
    for (const { date, seedValue } of entries) {
      const seed = Number(seedValue);
      if (dailySeeds.value[date] === seed) continue;
      dailySeeds.value[date] = seed;
      changed = true;
    }
    if (changed) setLocalItem('vegtab_daily_seeds', JSON.stringify(dailySeeds.value));
  }

  /** The seed of `dateStr` (default today, JST) if this device has received it, else null */
  function dailySeed(dateStr?: string): number | null {
    return dailySeeds.value[dateStr ?? todayJST()] ?? null;
  }

  let todaySeedRequest: Promise<void> | undefined;
  const monthSeedRequests = new Map<string, Promise<boolean>>();

  /** Today's seed, from the API unless already received. null when it cannot be reached and was never received */
  async function fetchTodaySeed(): Promise<number | null> {
    // This month's seeds (loadRecentSeeds at start) include today's
    await monthSeedRequests.get(todayJST().slice(0, 7));
    if (dailySeed() === null) {
      todaySeedRequest ??= api<{ date: string; seedValue: string }>('/api/seeds/daily')
        .then((res) => rememberDailySeeds([res]))
        .catch(() => { /* offline: only the seeds received before */ })
        .finally(() => { todaySeedRequest = undefined; });
      await todaySeedRequest;
    }
    return dailySeed();
  }

  /** The route of today's puzzle, for a button that opens it. Says so in a toast when today's seed cannot be had */
  async function todayPuzzlePath(): Promise<string | null> {
    const seed = await fetchTodaySeed();
    if (seed !== null) return `/puzzle/${seed}`;
    showToast('error', 'toast.dailySeedUnavailable');
    return null;
  }

  /** Receives the seeds of `month` ('YYYY-MM') up to today, unless all are here. Resolves to whether they are */
  function fetchMonthSeeds(month: string): Promise<boolean> {
    const today = todayJST();
    if (daysOfMonth(month).every((d) => d > today || dailySeeds.value[d] !== undefined)) return Promise.resolve(true);
    let request = monthSeedRequests.get(month);
    if (!request) {
      request = api<{ seeds: Array<{ date: string; seedValue: string }> }>(`/api/seeds/daily/calendar?month=${month}`)
        .then((res) => { rememberDailySeeds(res.seeds); return true; })
        .catch(() => false)
        .finally(() => monthSeedRequests.delete(month));
      monthSeedRequests.set(month, request);
    }
    return request;
  }

  /** The seeds of the days a score can still be sent for (today and the 60 days before) */
  async function loadRecentSeeds() {
    const today = todayJST().slice(0, 7);
    const months: string[] = [];
    for (let m = shiftDateStr(todayJST(), -SUBMITTABLE_DAYS).slice(0, 7); m <= today; m = nextMonth(m)) months.push(m);
    const results = await Promise.all(months.map(fetchMonthSeeds));
    recentSeedsLoaded ||= results.every(Boolean);
  }

  /**
   * Whether `seed` is a past day's puzzle. Without today's seed (offline, never received) only a seed
   * this device knows for another day counts as past: an unknown one may well be today's
   */
  function isPastDailySeed(seed: number): boolean {
    const today = dailySeed();
    if (today !== null) return seed !== today;
    return Object.entries(dailySeeds.value).some(([date, s]) => s === seed && date !== todayJST());
  }

  function randomSeed(): number {
    return ((Date.now() & 0x7fffffff) ^ (Math.random() * 0x7fffffff)) >>> 0;
  }

  /** The day of a daily seed received on this device, if a score can still be sent for it; else null */
  function findDailyDate(seed: number): string | null {
    const oldest = shiftDateStr(todayJST(), -SUBMITTABLE_DAYS);
    for (const [date, s] of Object.entries(dailySeeds.value)) {
      if (s === seed && date >= oldest) return date;
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

  /** その seed の自分の記録のうち最もよいもの（クリア優先 → 手数 → 時間）。記録がなければ null */
  function getBestResult(seed: number): ResultSummary | null {
    let best: ResultSummary | null = null;
    for (const r of getRecordsForSeed(seed)) {
      const summary = toSummary(r);
      if (!best || isBetterResult(summary, best)) best = summary;
    }
    return best;
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

  /** The days of `month` ('YYYY-MM') with their seeds; null for a day whose seed this device has not received */
  function getDailySeeds(month: string): { date: string; seed: number | null }[] {
    return daysOfMonth(month).map((date) => ({ date, seed: dailySeed(date) }));
  }

  function hasPlayedDaily(dateStr: string): boolean {
    const seed = dailySeed(dateStr);
    return seed !== null && playRecords.value.some(r => r.seed === seed);
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

  return {
    displayName, effectiveName, setDisplayName, claimHandoff,
    playRecords,
    dailySeed, fetchTodaySeed, todayPuzzlePath, fetchMonthSeeds, randomSeed,
    isPastDailySeed,
    addPlayRecord, getRecordsForSeed, getBestResult, getBestMoves,
    getDailySeeds, hasPlayedDaily,
    init, syncProfile, syncScoresFromServer, initialized,
    getShareCode,
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
