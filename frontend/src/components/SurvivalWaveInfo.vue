<script setup lang="ts">
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';

const { t } = useI18n();

const props = defineProps<{
  /** 現在までに発生済みのウェーブ番号（0 = 未発生） */
  currentWave: number;
  /** 次のウェーブまでの残りターン数 */
  movesUntilWave: number;
  /** 次のウェーブで侵食される個数 */
  nextObstacleCount: number;
  /** 予告表示中かどうか（残ターン数が短いほど強調） */
  isPreviewActive: boolean;
}>();

const warnLevel = computed(() => {
  if (!props.isPreviewActive) return 'normal';
  if (props.movesUntilWave <= 1) return 'urgent';
  return 'warn';
});
</script>

<template>
  <div :class="['wave-info', `wave-${warnLevel}`]">
    <div class="wave-row-main">
      <span class="wave-label">{{ t('mode.survivalWaveLabel') }}</span>
      <span class="wave-number">{{ currentWave }}</span>
    </div>
    <div class="wave-row-next">
      <span class="next-label">{{ t('mode.survivalNextWaveLabel') }}</span>
      <span class="next-value">
        {{ t('mode.survivalNextWave', { moves: movesUntilWave, count: nextObstacleCount }) }}
      </span>
    </div>
  </div>
</template>

<style scoped>
.wave-info {
  width: 100%;
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 12px;
  padding: 4px 0;
}
.wave-row-main {
  display: flex;
  align-items: baseline;
  gap: 6px;
}
.wave-label {
  font-size: 12px;
  font-weight: 700;
  color: var(--text-secondary);
  letter-spacing: 0.04em;
}
.wave-number {
  font-size: 22px;
  font-weight: 800;
  color: var(--text-primary);
  line-height: 1;
  font-variant-numeric: tabular-nums;
}
.wave-row-next {
  display: flex;
  align-items: baseline;
  gap: 4px;
  text-align: right;
}
.next-label {
  font-size: 10px;
  font-weight: 600;
  color: var(--text-muted);
}
.next-value {
  font-size: 13px;
  font-weight: 700;
  color: var(--text-secondary);
  font-variant-numeric: tabular-nums;
}
.wave-warn .wave-number,
.wave-warn .next-value {
  color: var(--warning, #ff9800);
}
.wave-urgent .wave-number,
.wave-urgent .next-value {
  color: var(--danger, #f44336);
  animation: wave-pulse 0.8s ease-in-out infinite;
}
@keyframes wave-pulse {
  0%, 100% { transform: scale(1); }
  50% { transform: scale(1.08); }
}
</style>
