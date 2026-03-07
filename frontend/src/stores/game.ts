import { defineStore } from 'pinia';
import { ref, computed } from 'vue';

// --- Types ---

export type ItemType = 'magnifying_glass' | 'scissors' | 'cutter' | 'clip' | 'coffee';

export interface ItemStock {
  magnifying_glass: number;
  scissors: number;
  cutter: number;
  clip: number;
  coffee: number;
}

export interface UnlockedSeed {
  seed: number;
  unlockedAt: number;
}

export interface PlayRecord {
  seed: number;
  mode: 'limited' | 'free';
  score: number;
  moves: number;
  playedAt: number;
  usedItems: boolean;
  playerName: string;
  isTrial: boolean; // true = unconfirmed trial play (not ranked)
}

export type SeedStatus =
  | 'daily_today'       // no stamina, unlimited retry, ranked
  | 'unlocked'          // already unlocked, unlimited retry, ranked
  | 'trial_available'   // 1 free trial, then unlock choice
  | 'trial_used'        // trial done, must unlock or give up
  ;

interface DailyState {
  date: string; // 'YYYY-MM-DD'
  staminaRecoveryCount: number; // max 5
  undoGranted: boolean;         // max 1/day
  todoCompletedCount: number;   // for item selection
  itemSelected: boolean;        // already picked today's item
}

const STAMINA_MAX = 5;
const STAMINA_RECOVERY_INTERVAL_MS = 30 * 60 * 1000; // 30 min
const UNDO_STOCK_MAX = 10;

// --- Store ---

export const useGameStore = defineStore('game', () => {
  const stamina = ref(loadNum('tomado_stamina', STAMINA_MAX));
  const lastStaminaRecoverAt = ref(loadNum('tomado_stamina_recover_at', Date.now()));
  const undoStock = ref(loadNum('tomado_undo_stock', 0));
  const items = ref<ItemStock>(loadJson('tomado_items', {
    magnifying_glass: 0, scissors: 0, cutter: 0, clip: 0, coffee: 0,
  }));
  const displayName = ref(loadStr('tomado_display_name', ''));
  const unlockedSeeds = ref<UnlockedSeed[]>(loadJson('tomado_unlocked_seeds', []));
  const trialSeeds = ref<number[]>(loadJson('tomado_trial_seeds', [])); // seeds with trial used
  const playRecords = ref<PlayRecord[]>(loadJson('tomado_play_records', []));
  const dailyState = ref<DailyState>(loadDailyState());

  function setDisplayName(name: string) {
    displayName.value = name.slice(0, 20);
    localStorage.setItem('tomado_display_name', displayName.value);
  }

  const effectiveName = computed(() => displayName.value || 'Anonymous');

  // --- Stamina ---

  const currentStamina = computed(() => {
    // Apply time-based recovery
    const now = Date.now();
    const elapsed = now - lastStaminaRecoverAt.value;
    const recovered = Math.floor(elapsed / STAMINA_RECOVERY_INTERVAL_MS);
    const effective = Math.min(stamina.value + recovered, STAMINA_MAX);
    return effective;
  });

  function tickStamina() {
    const now = Date.now();
    const elapsed = now - lastStaminaRecoverAt.value;
    const recovered = Math.floor(elapsed / STAMINA_RECOVERY_INTERVAL_MS);
    if (recovered > 0) {
      stamina.value = Math.min(stamina.value + recovered, STAMINA_MAX);
      lastStaminaRecoverAt.value += recovered * STAMINA_RECOVERY_INTERVAL_MS;
      saveStamina();
    }
  }

  function consumeStamina(): boolean {
    tickStamina();
    if (stamina.value <= 0) return false;
    stamina.value--;
    lastStaminaRecoverAt.value = Date.now();
    saveStamina();
    return true;
  }

  function recoverStaminaFromTodo(): boolean {
    ensureDailyState();
    if (dailyState.value.staminaRecoveryCount >= 5) return false;
    tickStamina();
    if (stamina.value >= STAMINA_MAX) return false;
    stamina.value = Math.min(stamina.value + 1, STAMINA_MAX);
    dailyState.value.staminaRecoveryCount++;
    saveStamina();
    saveDailyState();
    return true;
  }

  // --- Undo ---

  function grantUndoFromTodo(): boolean {
    ensureDailyState();
    if (dailyState.value.undoGranted) return false;
    if (undoStock.value >= UNDO_STOCK_MAX) return false;
    undoStock.value++;
    dailyState.value.undoGranted = true;
    localStorage.setItem('tomado_undo_stock', String(undoStock.value));
    saveDailyState();
    return true;
  }

  function useUndo(): boolean {
    if (undoStock.value <= 0) return false;
    undoStock.value--;
    localStorage.setItem('tomado_undo_stock', String(undoStock.value));
    return true;
  }

  // --- Items ---

  const availableItemChoices = computed<ItemType[]>(() => {
    ensureDailyState();
    const count = dailyState.value.todoCompletedCount;
    if (count < 2) return [];
    const choices: ItemType[] = ['magnifying_glass'];
    if (count >= 3) choices.push('scissors', 'cutter');
    if (count >= 4) choices.push('clip');
    if (count >= 5) choices.push('coffee');
    return choices;
  });

  const canSelectItem = computed(() => {
    ensureDailyState();
    return !dailyState.value.itemSelected && availableItemChoices.value.length > 0;
  });

  function selectItem(type: ItemType): boolean {
    ensureDailyState();
    if (dailyState.value.itemSelected) return false;
    if (!availableItemChoices.value.includes(type)) return false;
    items.value[type]++;
    dailyState.value.itemSelected = true;
    saveItems();
    saveDailyState();
    return true;
  }

  function consumeItem(type: ItemType): boolean {
    if (items.value[type] <= 0) return false;
    items.value[type]--;
    saveItems();
    return true;
  }

  // --- TODO completion hook ---

  function onTodoCompleted() {
    ensureDailyState();
    dailyState.value.todoCompletedCount++;
    recoverStaminaFromTodo();
    grantUndoFromTodo();
    saveDailyState();
  }

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

  function isSeedUnlocked(seed: number): boolean {
    return unlockedSeeds.value.some(s => s.seed === seed);
  }

  function isTrialUsed(seed: number): boolean {
    return trialSeeds.value.includes(seed);
  }

  function getSeedStatus(seed: number): SeedStatus {
    if (isTodaysDailySeed(seed)) return 'daily_today';
    if (isSeedUnlocked(seed)) return 'unlocked';
    if (isTrialUsed(seed)) return 'trial_used';
    return 'trial_available';
  }

  /** Can the player start a game with this seed? */
  function canPlay(seed: number): boolean {
    const status = getSeedStatus(seed);
    // trial_used means they already had their free play and haven't unlocked
    return status !== 'trial_used';
  }

  /** Can the player retry this seed? */
  function canRetry(seed: number): boolean {
    const status = getSeedStatus(seed);
    return status === 'daily_today' || status === 'unlocked';
  }

  function generateNewSeed(): number | null {
    tickStamina();
    if (stamina.value <= 0) return null;
    const seed = ((Date.now() & 0x7fffffff) ^ (Math.random() * 0x7fffffff)) >>> 0;
    if (!consumeStamina()) return null;
    unlockedSeeds.value.push({ seed, unlockedAt: Date.now() });
    saveSeeds();
    return seed;
  }

  /** Mark a seed as trial-played (1 free play used) */
  function markTrialUsed(seed: number) {
    if (!trialSeeds.value.includes(seed)) {
      trialSeeds.value.push(seed);
      saveTrials();
    }
  }

  /** Unlock a seed (costs 1 stamina). Returns false if insufficient stamina. */
  function unlockSeed(seed: number): boolean {
    if (isSeedUnlocked(seed)) return true;
    tickStamina();
    if (!consumeStamina()) return false;
    unlockedSeeds.value.push({ seed, unlockedAt: Date.now() });
    // Remove from trial list
    trialSeeds.value = trialSeeds.value.filter(s => s !== seed);
    saveSeeds();
    saveTrials();
    return true;
  }

  /** Discard trial record for a seed (user chose not to unlock) */
  function discardTrial(seed: number) {
    // Remove trial play records (isTrial=true) for this seed
    playRecords.value = playRecords.value.filter(r => !(r.seed === seed && r.isTrial));
    saveRecords();
  }

  // --- Play records ---

  function addPlayRecord(record: Omit<PlayRecord, 'playedAt' | 'playerName'>) {
    playRecords.value.push({
      ...record,
      playedAt: Date.now(),
      playerName: effectiveName.value,
      isTrial: record.isTrial ?? false,
    });
    saveRecords();
  }

  function getRecordsForSeed(seed: number, mode?: 'limited' | 'free'): PlayRecord[] {
    return playRecords.value.filter(r =>
      r.seed === seed && (mode === undefined || r.mode === mode)
    );
  }

  function getBestScore(seed: number, mode: 'limited' | 'free'): number {
    const records = getRecordsForSeed(seed, mode).filter(r => !r.usedItems && !r.isTrial);
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

  // --- Daily state management ---

  function ensureDailyState() {
    const today = todayLocal();
    if (dailyState.value.date !== today) {
      dailyState.value = {
        date: today,
        staminaRecoveryCount: 0,
        undoGranted: false,
        todoCompletedCount: 0,
        itemSelected: false,
      };
      saveDailyState();
    }
  }

  // --- Persistence ---

  function saveStamina() {
    localStorage.setItem('tomado_stamina', String(stamina.value));
    localStorage.setItem('tomado_stamina_recover_at', String(lastStaminaRecoverAt.value));
  }

  function saveItems() {
    localStorage.setItem('tomado_items', JSON.stringify(items.value));
  }

  function saveSeeds() {
    localStorage.setItem('tomado_unlocked_seeds', JSON.stringify(unlockedSeeds.value));
  }

  function saveTrials() {
    localStorage.setItem('tomado_trial_seeds', JSON.stringify(trialSeeds.value));
  }

  function saveRecords() {
    localStorage.setItem('tomado_play_records', JSON.stringify(playRecords.value));
  }

  function saveDailyState() {
    localStorage.setItem('tomado_daily_state', JSON.stringify(dailyState.value));
  }

  return {
    displayName, effectiveName, setDisplayName,
    stamina, undoStock, items, unlockedSeeds, playRecords, dailyState,
    currentStamina, availableItemChoices, canSelectItem,
    tickStamina, consumeStamina, recoverStaminaFromTodo,
    grantUndoFromTodo, useUndo,
    selectItem, consumeItem,
    onTodoCompleted,
    generateDailySeed, generateNewSeed,
    isSeedUnlocked, isTodaysDailySeed, isTrialUsed,
    getSeedStatus, canPlay, canRetry,
    unlockSeed, markTrialUsed, discardTrial,
    addPlayRecord, getRecordsForSeed, getBestScore,
    getDailySeeds, hasPlayedDaily,
    ensureDailyState,
  };
});

// --- Helpers ---

function todayLocal(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function loadStr(key: string, fallback: string): string {
  try {
    return localStorage.getItem(key) ?? fallback;
  } catch {
    return fallback;
  }
}

function loadNum(key: string, fallback: number): number {
  try {
    const raw = localStorage.getItem(key);
    return raw ? Number(raw) : fallback;
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

function loadDailyState(): DailyState {
  const today = todayLocal();
  try {
    const raw = localStorage.getItem('tomado_daily_state');
    if (raw) {
      const data = JSON.parse(raw);
      if (data.date === today) return data;
    }
  } catch { /* ignore */ }
  return {
    date: today,
    staminaRecoveryCount: 0,
    undoGranted: false,
    todoCompletedCount: 0,
    itemSelected: false,
  };
}
