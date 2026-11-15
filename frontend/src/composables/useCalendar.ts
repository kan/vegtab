import { ref, computed, watch } from 'vue';
import { useGameStore } from '@/stores/game';

export function useCalendar() {
  const gameStore = useGameStore();
  const now = new Date();
  const year = ref(now.getFullYear());
  const month = ref(now.getMonth()); // 0-indexed

  const monthKey = computed(() => `${year.value}-${String(month.value + 1).padStart(2, '0')}`);
  const days = computed(() => gameStore.getDailySeeds(monthKey.value));

  /** The seeds come from the API (the device cannot compute them, #116); the days already received are not asked again */
  function loadMonth() {
    gameStore.fetchMonthSeeds(monthKey.value);
  }
  watch(monthKey, loadMonth, { immediate: true });

  const monthLabel = computed(() => {
    const d = new Date(year.value, month.value);
    return d.toLocaleDateString('ja-JP', { year: 'numeric', month: 'long' });
  });

  const grid = computed(() => {
    const firstDay = new Date(year.value, month.value, 1).getDay();
    const result: (typeof days.value[0] | null)[] = [];
    for (let i = 0; i < firstDay; i++) result.push(null);
    for (const d of days.value) result.push(d);
    return result;
  });

  const isCurrentMonth = computed(() => {
    const n = new Date();
    return year.value === n.getFullYear() && month.value === n.getMonth();
  });

  /** The month of the first daily ever handed out: the calendar does not page back past it (unknown until the API says) */
  const isFirstMonth = computed(() => {
    const first = gameStore.firstDailyDate;
    return first !== null && monthKey.value <= first.slice(0, 7);
  });

  function prevMonth() {
    if (isFirstMonth.value) return;
    if (month.value === 0) {
      month.value = 11;
      year.value--;
    } else {
      month.value--;
    }
  }

  function nextMonth() {
    if (isCurrentMonth.value) return;
    if (month.value === 11) {
      month.value = 0;
      year.value++;
    } else {
      month.value++;
    }
  }

  /** その日のクリアの最少手数（クリアしていなければ 0。seed をまだ受け取っていない日も 0） */
  function bestMoves(seed: number | null): number {
    return seed === null ? 0 : gameStore.getBestMoves(seed);
  }

  return {
    year,
    month,
    days,
    loadMonth,
    monthLabel,
    grid,
    isCurrentMonth,
    isFirstMonth,
    prevMonth,
    nextMonth,
    bestMoves,
  };
}
