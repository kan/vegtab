<script setup lang="ts">
import { ref, computed, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRouter } from 'vue-router';
import { api, getUserId } from '@/api/client';
import { goldMedalIcon, silverMedalIcon, bronzeMedalIcon, playIcon, brickIcon } from '@/assets/icons';

const { t } = useI18n();
const router = useRouter();

const props = defineProps<{
  seed: number;
  open: boolean;
}>();

const emit = defineEmits<{
  close: [];
}>();

const loading = ref(false);

interface RankEntry {
  rank: number;
  score: number;
  moves: number;
  playerName: string;
  isMe: boolean;
  scoreId?: string;
}

const rankings = ref<RankEntry[]>([]);
const myRank = ref<{ rank: number; score: number; moveCount: number } | null>(null);

watch(() => props.open, (o) => { if (o) fetchRanking(); });

let fetchSeq = 0;

async function fetchRanking() {
  const seq = ++fetchSeq;
  loading.value = true;
  try {
    const userId = getUserId();
    const data = await api<{
      ranking: Array<{
        rank: number;
        userId: string;
        displayName: string;
        score: number;
        moveCount: number;
        scoreId?: string;
      }>;
      userRank: { rank: number; score: number; moveCount: number } | null;
    }>(`/api/rankings/by-value/${props.seed}`);

    if (seq !== fetchSeq) return; // stale response
    rankings.value = data.ranking.map(e => ({
      rank: e.rank,
      score: e.score,
      moves: e.moveCount,
      playerName: e.displayName,
      isMe: e.userId === userId,
      scoreId: e.scoreId,
    }));
    myRank.value = data.userRank;
  } catch {
    if (seq !== fetchSeq) return;
    rankings.value = [];
    myRank.value = null;
  }
  loading.value = false;
}

const myRankDisplay = computed(() => myRank.value ? t('ranking.moves', { count: myRank.value.moveCount }) : '');

function rankMedalIcon(rank: number): string | null {
  if (rank === 1) return goldMedalIcon;
  if (rank === 2) return silverMedalIcon;
  if (rank === 3) return bronzeMedalIcon;
  return null;
}

function goToReplay(scoreId: string) {
  emit('close');
  router.push(`/replay/${scoreId}`);
}
</script>

<template>
  <Teleport to="body">
    <div v-if="open" class="ranking-overlay" @click.self="emit('close')">
      <div class="ranking-modal">
        <div class="ranking-header">
          <h2 class="ranking-title"><img class="ranking-title-icon" :src="brickIcon" alt="" /> {{ t('common.ranking') }}</h2>
          <span class="ranking-seed">{{ t('common.seed', { seed }) }}</span>
          <button class="ranking-close" @click="emit('close')">&times;</button>
        </div>

        <!-- Loading skeleton -->
        <template v-if="loading">
          <div class="my-rank-card skeleton-card">
            <div class="skeleton-line skeleton-short" />
            <div class="skeleton-line skeleton-wide" />
          </div>
          <div class="ranking-list">
            <div v-for="i in 5" :key="i" class="ranking-row skeleton-row">
              <span class="skeleton-circle" />
              <div class="skeleton-text">
                <div class="skeleton-line skeleton-wide" />
                <div class="skeleton-line skeleton-short" />
              </div>
              <span class="skeleton-line skeleton-score" />
            </div>
          </div>
        </template>

        <!-- My rank highlight -->
        <template v-else>
        <div v-if="myRank" class="my-rank-card">
          <div class="my-rank-left">
            <span class="my-rank-label">{{ t('ranking.yourRank') }}</span>
            <span class="my-rank-num">{{ myRank.rank }}<span class="my-rank-total"> / {{ rankings.length || myRank.rank }}</span></span>
          </div>
          <div class="my-rank-right">
            <span class="my-rank-score">{{ myRankDisplay }}</span>
            <span class="my-rank-sub">{{ myRank.score.toLocaleString() }}</span>
          </div>
        </div>
        <div v-else class="my-rank-card my-rank-empty">
          <span class="my-rank-label">{{ t('ranking.noRecord') }}</span>
        </div>

        <!-- Ranking list -->
        <div v-if="rankings.length > 0" class="ranking-list">
          <div
            v-for="(entry, i) in rankings"
            :key="i"
            :class="['ranking-row', { me: entry.isMe }]"
          >
            <span class="rank-num"><img v-if="rankMedalIcon(entry.rank)" :src="rankMedalIcon(entry.rank)!" class="rank-medal" alt="" /><template v-else>#{{ entry.rank }}</template></span>
            <div class="rank-main">
              <span class="rank-name">{{ entry.playerName }}</span>
            </div>
            <div class="rank-right">
              <span class="rank-score">{{ t('ranking.moves', { count: entry.moves }) }}</span>
              <span class="rank-sub">{{ entry.score.toLocaleString() }}</span>
            </div>
            <button
              v-if="entry.scoreId"
              class="btn-replay"
              @click="goToReplay(entry.scoreId!)"
              :title="t('replay.viewReplay')"
            ><img :src="playIcon" class="replay-icon" alt="" /></button>
          </div>
        </div>
        <div v-else class="ranking-empty">
          {{ t('common.noRecords') }}
        </div>
        </template>
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
  display: flex;
  align-items: center;
  gap: 6px;
}
.ranking-title-icon {
  width: 20px;
  height: 20px;
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
.rank-right {
  text-align: right;
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  align-items: flex-end;
}
.rank-score {
  font-weight: 700;
  color: var(--text-primary);
  font-size: 14px;
}
.rank-sub {
  font-size: 10px;
  color: var(--text-muted);
  font-weight: 500;
}
.my-rank-sub {
  font-size: 13px;
  color: var(--text-muted);
  font-weight: 500;
}
.btn-replay {
  background: var(--brand);
  color: #fff;
  border: none;
  border-radius: 4px;
  width: 28px;
  height: 28px;
  font-size: 12px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}
.rank-medal {
  width: 22px;
  height: 22px;
  vertical-align: middle;
}
.replay-icon {
  width: 16px;
  height: 16px;
}
.ranking-empty {
  text-align: center;
  padding: 32px;
  color: var(--text-disabled);
  font-size: 14px;
}

/* Skeleton loading (animation in theme.css) */
.skeleton-card {
  flex-direction: column;
  gap: 8px;
  background: var(--bg-card-alt);
}
.skeleton-row { gap: 10px; }
.skeleton-circle { width: 24px; height: 24px; flex-shrink: 0; }
.skeleton-text { flex: 1; display: flex; flex-direction: column; gap: 4px; }
.skeleton-line { height: 12px; }
.skeleton-wide { width: 70%; }
.skeleton-short { width: 40%; }
.skeleton-score { width: 48px; height: 14px; flex-shrink: 0; }
</style>
