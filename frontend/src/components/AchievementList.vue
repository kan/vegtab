<script setup lang="ts">
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { useAchievementStore } from '@/stores/achievements';
import { ACHIEVEMENT_DEFS } from '@vegtab/engine';
import { trophyIcon, questionIcon, lockIcon, checkIcon } from '@/assets/icons';

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
      icon: unlocked ? trophyIcon : def.secret && !unlocked ? questionIcon : lockIcon,
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
      <img class="achievement-icon" :src="item.icon" alt="" />
      <div class="achievement-info">
        <span class="achievement-name">{{ item.name }}</span>
        <span class="achievement-desc">{{ item.desc }}</span>
      </div>
      <img v-if="item.unlocked" class="achievement-check" :src="checkIcon" alt="" />
    </div>
  </div>
</template>

<style scoped>
.achievement-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.achievement-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  min-height: 44px;
  margin-bottom: 4px;
}
.achievement-title {
  font-size: 24px;
  font-weight: 800;
  color: var(--ink);
}
.achievement-count {
  padding: 2px 12px;
  border: var(--frame-thin);
  border-radius: 999px;
  background: var(--brand-light);
  font-size: 14px;
  font-weight: 800;
  color: var(--ink);
}
/* Locked: a light frame and faded. Unlocked: the ink frame on green */
.achievement-item {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 14px;
  background: var(--bg-card);
  border-radius: 14px;
  border: 2px solid var(--border);
  color: var(--text-muted);
}
.achievement-item.unlocked {
  border-color: var(--ink);
  background: var(--brand-light);
  color: var(--ink);
}
.achievement-item:not(.unlocked) .achievement-icon {
  opacity: 0.5;
}
.achievement-item.secret {
  border-style: dashed;
}
.achievement-icon {
  width: 24px;
  height: 24px;
  flex-shrink: 0;
}
.achievement-info {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 1px;
  min-width: 0;
}
.achievement-name {
  font-size: 15px;
  font-weight: 800;
}
.achievement-desc {
  font-size: 13px;
}
.achievement-check {
  width: 18px;
  height: 18px;
  flex-shrink: 0;
}
</style>
