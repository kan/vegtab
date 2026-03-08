<script setup lang="ts">
import { ref, computed, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { useGameStore, type PlayRecord } from '@/stores/game';

const { t } = useI18n();

const props = defineProps<{
  seed: number;
  open: boolean;
}>();

const emit = defineEmits<{
  close: [];
}>();

const gameStore = useGameStore();
const activeTab = ref<'limited' | 'free'>('limited');

interface RankEntry {
  rank: number;
  score: number;
  moves: number;
  playedAt: number;
  usedItems: boolean;
  playerName: string;
  isMe: boolean;
}

const rankings = computed<RankEntry[]>(() => {
  const records = gameStore.getRecordsForSeed(props.seed, activeTab.value);
  const myName = gameStore.effectiveName;
  const sorted = [...records].sort((a, b) => b.score - a.score);
  return sorted.map((r, i) => ({
    rank: i + 1,
    score: r.score,
    moves: r.moves,
    playedAt: r.playedAt,
    usedItems: r.usedItems,
    playerName: r.playerName || 'Anonymous',
    isMe: (r.playerName || 'Anonymous') === myName,
  }));
});

const myBestRank = computed(() => {
  const eligible = rankings.value.filter(r => r.isMe && !r.usedItems);
  return eligible.length > 0 ? eligible[0].rank : null;
});

const myBestScore = computed(() => {
  const eligible = rankings.value.filter(r => r.isMe && !r.usedItems);
  return eligible.length > 0 ? eligible[0].score : 0;
});

const totalEntries = computed(() => rankings.value.filter(r => !r.usedItems).length);

function formatDate(ts: number): string {
  const d = new Date(ts);
  return `${d.getMonth() + 1}/${d.getDate()} ${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function rankIcon(rank: number): string {
  if (rank === 1) return '\u{1F947}';
  if (rank === 2) return '\u{1F948}';
  if (rank === 3) return '\u{1F949}';
  return `#${rank}`;
}

watch(() => props.open, (v) => {
  if (v) activeTab.value = 'limited';
});
</script>

<template>
  <Teleport to="body">
    <div v-if="open" class="ranking-overlay" @click.self="emit('close')">
      <div class="ranking-modal">
        <div class="ranking-header">
          <h2 class="ranking-title">{{ t('common.ranking') }}</h2>
          <span class="ranking-seed">{{ t('common.seed', { seed }) }}</span>
          <button class="ranking-close" @click="emit('close')">&times;</button>
        </div>

        <!-- Mode tabs -->
        <div class="ranking-tabs">
          <button
            :class="['tab', { active: activeTab === 'limited' }]"
            @click="activeTab = 'limited'"
          >{{ t('puzzle.limited') }}</button>
          <button
            :class="['tab', { active: activeTab === 'free' }]"
            @click="activeTab = 'free'"
          >{{ t('puzzle.free') }}</button>
        </div>

        <!-- My rank highlight -->
        <div v-if="myBestRank !== null" class="my-rank-card">
          <div class="my-rank-left">
            <span class="my-rank-label">{{ t('ranking.yourRank') }}</span>
            <span class="my-rank-num">{{ myBestRank }}<span class="my-rank-total"> / {{ totalEntries }}</span></span>
          </div>
          <div class="my-rank-right">
            <span class="my-rank-score">{{ myBestScore.toLocaleString() }}</span>
            <span class="my-rank-name">{{ gameStore.effectiveName }}</span>
          </div>
        </div>
        <div v-else class="my-rank-card my-rank-empty">
          <span class="my-rank-label">{{ t('ranking.noRecord') }}</span>
        </div>

        <!-- Ranking list -->
        <div v-if="rankings.length > 0" class="ranking-list">
          <div
            v-for="entry in rankings"
            :key="entry.playedAt"
            :class="['ranking-row', { ref: entry.usedItems, me: entry.isMe }]"
          >
            <span class="rank-num">{{ rankIcon(entry.rank) }}</span>
            <div class="rank-main">
              <span class="rank-name">{{ entry.playerName }}</span>
              <span class="rank-meta">{{ t('ranking.moves', { count: entry.moves }) }} &middot; {{ formatDate(entry.playedAt) }}</span>
            </div>
            <div class="rank-right">
              <span class="rank-score">{{ entry.score.toLocaleString() }}</span>
              <span v-if="entry.usedItems" class="rank-ref">{{ t('puzzle.ref') }}</span>
            </div>
          </div>
        </div>
        <div v-else class="ranking-empty">
          {{ t('common.noRecords') }}
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.ranking-overlay {
  position: fixed;
  inset: 0;
  background: var(--overlay-bg);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
}
.ranking-modal {
  background: var(--bg-card);
  border-radius: 16px;
  padding: 20px;
  width: 360px;
  max-width: 95vw;
  max-height: 80vh;
  display: flex;
  flex-direction: column;
  box-shadow: var(--shadow-modal);
}
.ranking-header {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 12px;
}
.ranking-title {
  font-size: 18px;
  font-weight: 700;
  color: var(--text-primary);
  margin: 0;
}
.ranking-seed {
  flex: 1;
  font-size: 11px;
  color: var(--text-muted);
  font-family: monospace;
}
.ranking-close {
  background: none;
  border: none;
  font-size: 24px;
  color: var(--text-muted);
  cursor: pointer;
  line-height: 1;
  padding: 0 4px;
}

/* Tabs */
.ranking-tabs {
  display: flex;
  gap: 4px;
  margin-bottom: 12px;
}
.tab {
  flex: 1;
  padding: 8px;
  border: none;
  border-radius: 6px;
  font-size: 12px;
  font-weight: 700;
  cursor: pointer;
  background: var(--bg-hover);
  color: var(--text-muted);
  letter-spacing: 0.5px;
  transition: all 0.15s;
}
.tab.active {
  background: var(--brand);
  color: #fff;
}
.tab.active:nth-child(2) {
  background: var(--success);
}

/* My rank card */
.my-rank-card {
  display: flex;
  align-items: center;
  justify-content: space-between;
  background: var(--rank-highlight-bg);
  border-radius: 10px;
  padding: 12px 16px;
  margin-bottom: 12px;
}
.my-rank-card.my-rank-empty {
  justify-content: center;
  background: var(--bg-card-alt);
}
.my-rank-left {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.my-rank-label {
  font-size: 10px;
  color: var(--text-muted);
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}
.my-rank-num {
  font-size: 28px;
  font-weight: 700;
  color: var(--brand);
}
.my-rank-total {
  font-size: 14px;
  font-weight: 400;
  color: var(--text-muted);
}
.my-rank-right {
  text-align: right;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.my-rank-score {
  font-size: 20px;
  font-weight: 700;
  color: var(--text-primary);
}
.my-rank-name {
  font-size: 12px;
  color: var(--text-tertiary);
}

/* List */
.ranking-list {
  overflow-y: auto;
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.ranking-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 10px;
  background: var(--bg-card-alt);
  border-radius: 6px;
  font-size: 13px;
}
.ranking-row.ref {
  opacity: 0.5;
}
.ranking-row.me {
  background: var(--rank-me-bg);
  border: 1px solid var(--rank-me-border);
}
.rank-num {
  width: 32px;
  font-weight: 700;
  color: var(--text-secondary);
  flex-shrink: 0;
  font-size: 14px;
}
.rank-main {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 1px;
  min-width: 0;
}
.rank-name {
  font-weight: 600;
  color: var(--text-primary);
  font-size: 13px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.rank-meta {
  font-size: 10px;
  color: var(--text-disabled);
}
.rank-right {
  text-align: right;
  flex-shrink: 0;
}
.rank-score {
  font-weight: 700;
  color: var(--text-primary);
  font-size: 14px;
}
.rank-ref {
  display: block;
  font-size: 9px;
  font-weight: 700;
  color: var(--warning);
}
.ranking-empty {
  text-align: center;
  padding: 32px;
  color: var(--text-disabled);
  font-size: 14px;
}
</style>
