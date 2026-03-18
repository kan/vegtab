<script setup lang="ts">
import { useI18n } from 'vue-i18n';
import { useGameStore, type GameMode } from '@/stores/game';
import { MODE_ICONS } from '@/utils/constants';

const { t } = useI18n();

const props = defineProps<{
  seed: number;
  open: boolean;
}>();

const emit = defineEmits<{
  select: [mode: GameMode];
  close: [];
}>();

const gameStore = useGameStore();

const modes: { key: GameMode; icon: string }[] = [
  { key: 'sprint', icon: MODE_ICONS.sprint },
  { key: 'clear', icon: MODE_ICONS.clear },
  { key: 'survival', icon: MODE_ICONS.survival },
  { key: 'cascade', icon: MODE_ICONS.cascade },
];

function bestForMode(mode: GameMode): string {
  if (mode === 'sprint') {
    const s = gameStore.getBestScore(props.seed, 'sprint');
    return s > 0 ? `${s.toLocaleString()} pts` : '';
  }
  if (mode === 'clear') {
    const s = gameStore.getBestScore(props.seed, 'clear');
    return s > 0 ? `${s} ${t('mode.moves')}` : '';
  }
  if (mode === 'survival') {
    const m = gameStore.getBestMoves(props.seed, 'survival');
    return m > 0 ? `${m} ${t('mode.moves')}` : '';
  }
  if (mode === 'cascade') {
    const c = gameStore.getBestMaxChain(props.seed);
    return c > 0 ? `${c} ${t('mode.chain')}` : '';
  }
  return '';
}
</script>

<template>
  <Teleport to="body">
    <div v-if="open" class="mode-overlay" @click.self="emit('close')">
      <div class="mode-modal">
        <div class="mode-header">
          <h2 class="mode-title">{{ t('mode.selectTitle') }}</h2>
          <button class="mode-close" @click="emit('close')">&times;</button>
        </div>
        <div class="mode-cards">
          <button
            v-for="m in modes"
            :key="m.key"
            class="mode-card"
            @click="emit('select', m.key)"
          >
            <img class="mode-icon" :src="m.icon" alt="" />
            <span class="mode-name">{{ t(`mode.${m.key}`) }}</span>
            <span class="mode-desc">{{ t(`mode.${m.key}Desc`) }}</span>
            <span v-if="bestForMode(m.key)" class="mode-best">{{ bestForMode(m.key) }}</span>
          </button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.mode-overlay {
  position: fixed;
  inset: 0;
  background: var(--overlay-bg);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
}
.mode-modal {
  background: var(--bg-card);
  border-radius: 16px;
  padding: 20px;
  width: 340px;
  max-width: 95vw;
  box-shadow: var(--shadow-modal);
}
.mode-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 16px;
}
.mode-title {
  font-size: 18px;
  font-weight: 700;
  color: var(--text-primary);
  margin: 0;
}
.mode-close {
  background: none;
  border: none;
  font-size: 24px;
  color: var(--text-muted);
  cursor: pointer;
  line-height: 1;
  padding: 0 4px;
}
.mode-cards {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.mode-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  padding: 16px;
  border: 2px solid var(--border);
  border-radius: 12px;
  background: var(--bg-card-alt);
  cursor: pointer;
  transition: border-color 0.15s, transform 0.1s;
}
.mode-card:hover {
  border-color: var(--brand);
}
.mode-card:active {
  transform: scale(0.97);
}
.mode-icon {
  width: 28px;
  height: 28px;
}
.mode-name {
  font-size: 16px;
  font-weight: 700;
  color: var(--text-primary);
}
.mode-desc {
  font-size: 12px;
  color: var(--text-muted);
  text-align: center;
}
.mode-best {
  font-size: 13px;
  font-weight: 600;
  color: var(--brand);
  margin-top: 2px;
}
</style>
