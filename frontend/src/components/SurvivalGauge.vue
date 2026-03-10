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
  const p = progress.value;
  if (p >= 80) return 'var(--success, #4caf50)';
  if (p >= 50) return 'var(--warning, #ff9800)';
  return 'var(--danger, #f44336)';
});

const remaining = computed(() => {
  return Math.max(0, props.quota - props.currentScore);
});
</script>

<template>
  <div class="survival-gauge">
    <div class="gauge-header">
      <span class="gauge-quota">
        {{ t('mode.survivalQuota', { moves: movesUntilCheck, target: remaining.toLocaleString() }) }}
      </span>
      <span class="gauge-score">
        {{ t('mode.survivalProgress', { current: currentScore.toLocaleString(), target: quota.toLocaleString() }) }}
      </span>
    </div>
    <div class="gauge-track">
      <div
        class="gauge-fill"
        :style="{ width: progress + '%', background: barColor }"
      />
      <span class="gauge-moves-badge">{{ movesUntilCheck }}</span>
    </div>
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
.gauge-quota {
  font-size: 11px;
  font-weight: 700;
  color: var(--text-primary);
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
