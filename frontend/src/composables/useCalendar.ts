import { ref, computed } from 'vue';
import { useGameStore } from '@/stores/game';

export function useCalendar() {
  const gameStore = useGameStore();
  const now = new Date();
  const year = ref(now.getFullYear());
  const month = ref(now.getMonth()); // 0-indexed

  const days = computed(() => gameStore.getDailySeeds(year.value, month.value));

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

  function prevMonth() {
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

  /** その日のクリアの最少手数（クリアしていなければ 0） */
  function bestMoves(seed: number): number {
    return gameStore.getBestMoves(seed);
  }

  return {
    year,
    month,
    days,
    monthLabel,
    grid,
    isCurrentMonth,
    prevMonth,
    nextMonth,
    bestMoves,
  };
}
