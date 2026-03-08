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
  background: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
}
.ranking-modal {
  background: #fff;
  border-radius: 16px;
  padding: 20px;
  width: 360px;
  max-width: 95vw;
  max-height: 80vh;
  display: flex;
  flex-direction: column;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.3);
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
  color: #333;
  margin: 0;
}
.ranking-seed {
  flex: 1;
  font-size: 11px;
  color: #999;
  font-family: monospace;
}
.ranking-close {
  background: none;
  border: none;
  font-size: 24px;
  color: #999;
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
  background: #f0ebe3;
  color: #999;
  letter-spacing: 0.5px;
  transition: all 0.15s;
}
.tab.active {
  background: #c0392b;
  color: #fff;
}
.tab.active:nth-child(2) {
  background: #27ae60;
}

/* My rank card */
.my-rank-card {
  display: flex;
  align-items: center;
  justify-content: space-between;
  background: #fdf6d0;
  border-radius: 10px;
  padding: 12px 16px;
  margin-bottom: 12px;
}
.my-rank-card.my-rank-empty {
  justify-content: center;
  background: #f8f5f0;
}
.my-rank-left {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.my-rank-label {
  font-size: 10px;
  color: #999;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}
.my-rank-num {
  font-size: 28px;
  font-weight: 700;
  color: #c0392b;
}
.my-rank-total {
  font-size: 14px;
  font-weight: 400;
  color: #999;
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
  color: #333;
}
.my-rank-name {
  font-size: 12px;
  color: #888;
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
  background: #f8f5f0;
  border-radius: 6px;
  font-size: 13px;
}
.ranking-row.ref {
  opacity: 0.5;
}
.ranking-row.me {
  background: #e8f4fd;
  border: 1px solid #b8d9f0;
}
.rank-num {
  width: 32px;
  font-weight: 700;
  color: #666;
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
  color: #333;
  font-size: 13px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.rank-meta {
  font-size: 10px;
  color: #bbb;
}
.rank-right {
  text-align: right;
  flex-shrink: 0;
}
.rank-score {
  font-weight: 700;
  color: #333;
  font-size: 14px;
}
.rank-ref {
  display: block;
  font-size: 9px;
  font-weight: 700;
  color: #f39c12;
}
.ranking-empty {
  text-align: center;
  padding: 32px;
  color: #bbb;
  font-size: 14px;
}
</style>
