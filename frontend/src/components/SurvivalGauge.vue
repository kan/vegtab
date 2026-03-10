<script setup lang="ts">
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';

const { t } = useI18n();

const props = defineProps<{
  currentScore: number;
  quota: number;
  movesUntilCheck: number;
}>();

const progress = computed(() => {
  if (props.quota <= 0) return 100;
  return Math.min(100, Math.round((props.currentScore / props.quota) * 100));
});

const barColor = computed(() => {
  if (progress.value >= 100) return 'var(--success, #4caf50)';
  return 'var(--warning, #ff9800)';
});

const remaining = computed(() => {
  return Math.max(0, props.quota - props.currentScore);
});

const isQuotaMet = computed(() => progress.value >= 100);
</script>

<template>
  <div class="survival-gauge">
    <div class="gauge-header">
      <div class="gauge-main">
        <span class="gauge-label">{{ t('mode.survivalQuotaPre') }}</span>
        <span class="gauge-number">{{ movesUntilCheck }}</span>
        <span class="gauge-label">{{ t('mode.survivalQuotaMid') }}</span>
        <span class="gauge-number">{{ remaining.toLocaleString() }}</span>
        <span class="gauge-label">{{ t('mode.survivalQuotaSuf') }}</span>
      </div>
      <span class="gauge-score">
        {{ t('mode.survivalProgress', { current: currentScore.toLocaleString(), target: quota.toLocaleString() }) }}
      </span>
    </div>
    <div class="gauge-track">
      <div
        :class="['gauge-fill', { 'gauge-fill-met': isQuotaMet }]"
        :style="{ width: progress + '%', background: barColor }"
      />
      <span class="gauge-moves-badge">{{ movesUntilCheck }}</span>
    </div>
    <div v-if="isQuotaMet" class="gauge-met-label">{{ t('mode.quotaCleared') }}</div>
  </div>
</template>

<style scoped>
.survival-gauge {
  width: 100%;
}
.gauge-header {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  margin-bottom: 3px;
}
.gauge-main {
  display: flex;
  align-items: baseline;
  gap: 2px;
}
.gauge-number {
  font-size: 22px;
  font-weight: 800;
  color: var(--text-primary);
  line-height: 1;
}
.gauge-label {
  font-size: 17px;
  font-weight: 700;
  color: var(--text-secondary);
}
.gauge-score {
  font-size: 10px;
  color: var(--text-muted);
  font-weight: 600;
}
.gauge-track {
  position: relative;
  height: 8px;
  background: var(--bg-card-alt);
  border-radius: 4px;
  overflow: visible;
}
.gauge-fill {
  height: 100%;
  border-radius: 4px;
  transition: width 0.3s ease, background 0.3s ease;
}
.gauge-fill-met {
  animation: none;
}
.gauge-met-label {
  font-size: 10px;
  font-weight: 700;
  color: var(--success, #4caf50);
  text-align: center;
  margin-top: 2px;
}
.gauge-moves-badge {
  position: absolute;
  right: -4px;
  top: -10px;
  font-size: 9px;
  font-weight: 700;
  color: #fff;
  background: var(--text-muted);
  min-width: 16px;
  height: 16px;
  line-height: 16px;
  text-align: center;
  border-radius: 8px;
  padding: 0 3px;
}
</style>
