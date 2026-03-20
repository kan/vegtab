import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import { api, showToast } from '@/api/client';
import { ACHIEVEMENT_DEFS, getAchievementDef, type AchievementDef } from '@vegtab/engine';
import { i18n } from '@/i18n';

export interface AchievementState {
  type: string;
  currentValue: number;
  isUnlocked: boolean;
  unlockedAt: string | null;
}

const STORAGE_KEY = 'tomado_achievements';

export const useAchievementStore = defineStore('achievements', () => {
  const achievements = ref<AchievementState[]>(loadFromStorage());
  const loaded = ref(false);

  const unlockedCount = computed(() =>
    achievements.value.filter(a => a.isUnlocked).length
  );

  const totalCount = computed(() => ACHIEVEMENT_DEFS.length);

  const stateMap = computed(() =>
    new Map(achievements.value.map(a => [a.type, a]))
  );

  function getState(type: string): AchievementState | undefined {
    return stateMap.value.get(type);
  }

  async function fetchAchievements() {
    try {
      const data = await api<{
        achievements: AchievementState[];
      }>('/api/achievements');
      achievements.value = data.achievements;
      saveToStorage();
      loaded.value = true;
    } catch {
      // Use cached data
      loaded.value = true;
    }
  }

  function handleNewAchievements(types: string[]) {
    const t = i18n.global.t;
    for (const type of types) {
      const def = getAchievementDef(type);
      if (!def) continue;

      // Update or create local state
      const existing = achievements.value.find(a => a.type === type);
      if (existing) {
        existing.isUnlocked = true;
        existing.unlockedAt = new Date().toISOString();
      } else {
        achievements.value.push({
          type,
          currentValue: def.threshold,
          isUnlocked: true,
          unlockedAt: new Date().toISOString(),
        });
      }

      const name = t(`achievement.${type}`);
      showToast('success', 'achievement.newUnlock', { name });
    }
    if (types.length > 0) saveToStorage();
  }

  function saveToStorage() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(achievements.value));
    } catch { /* ignore */ }
  }

  function loadFromStorage(): AchievementState[] {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch {
      return [];
    }
  }

  function reset() {
    achievements.value = [];
    saveToStorage();
    loaded.value = false;
  }

  return {
    achievements, unlockedCount, totalCount, loaded,
    getState,
    fetchAchievements, handleNewAchievements, reset,
  };
});
