<script setup lang="ts">
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { useAchievementStore } from '@/stores/achievements';
import { ACHIEVEMENT_DEFS } from '@tomado/engine';

const { t } = useI18n();
const store = useAchievementStore();

const items = computed(() =>
  ACHIEVEMENT_DEFS.map(def => {
    const state = store.getState(def.type);
    const unlocked = state?.isUnlocked ?? false;
    const showDetails = unlocked || !def.secret;
    return {
      type: def.type,
      category: def.category,
      unlocked,
      secret: def.secret && !unlocked,
      name: showDetails ? t(`achievement.${def.type}`) : t('achievement.secret'),
      desc: showDetails ? t(`achievement.${def.type}_desc`) : t('achievement.secretDesc'),
      progress: state?.currentValue ?? 0,
      threshold: def.threshold,
      comparator: def.comparator,
    };
  }),
);
</script>

<template>
  <div class="achievement-list">
    <div class="achievement-header">
      <span class="achievement-title">{{ t('achievement.title') }}</span>
      <span class="achievement-count">{{ store.unlockedCount }} / {{ store.totalCount }}</span>
    </div>
    <div v-for="item in items" :key="item.type" :class="['achievement-item', { unlocked: item.unlocked, secret: item.secret }]">
      <span class="achievement-icon">{{ item.unlocked ? '🏆' : item.secret ? '❓' : '🔒' }}</span>
      <div class="achievement-info">
        <span class="achievement-name">{{ item.name }}</span>
        <span class="achievement-desc">{{ item.desc }}</span>
      </div>
      <span v-if="item.unlocked" class="achievement-check">&#x2714;</span>
    </div>
  </div>
</template>

<style scoped>
.achievement-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.achievement-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.achievement-title {
  font-size: 13px;
  font-weight: 700;
  color: var(--text-secondary);
  text-transform: uppercase;
  letter-spacing: 0.5px;
}
.achievement-count {
  font-size: 12px;
  font-weight: 600;
  color: var(--brand);
}
.achievement-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 12px;
  background: var(--bg-card);
  border-radius: 8px;
  border: 1px solid var(--border);
  opacity: 0.55;
  transition: opacity 0.2s;
}
.achievement-item.unlocked {
  opacity: 1;
  border-color: var(--brand);
}
.achievement-item.secret {
  opacity: 0.35;
}
.achievement-icon {
  font-size: 20px;
  flex-shrink: 0;
  width: 28px;
  text-align: center;
}
.achievement-info {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 1px;
  min-width: 0;
}
.achievement-name {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-primary);
}
.achievement-desc {
  font-size: 11px;
  color: var(--text-muted);
}
.achievement-check {
  color: var(--brand);
  font-size: 16px;
  font-weight: 700;
  flex-shrink: 0;
}
</style>
