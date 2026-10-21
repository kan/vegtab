<script setup lang="ts">
import { ref, computed, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRouter } from 'vue-router';
import { api } from '@/api/client';
import { getUserId } from '@/api/id';
import { formatRecordTime } from '@/lib/playTime';
import { playIcon, trophyIcon } from '@/assets/icons';
import { rankMedalIcon } from '@/lib/rankMedal';
import CloseButton from './CloseButton.vue';

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
  moves: number;
  clearTimeMs: number | null;
  playerName: string;
  isMe: boolean;
  scoreId?: string;
}

const rankings = ref<RankEntry[]>([]);
const myRank = ref<{ rank: number; moveCount: number; clearTimeMs: number | null } | null>(null);

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
        moveCount: number;
        clearTimeMs: number | null;
        scoreId?: string;
      }>;
      userRank: { rank: number; moveCount: number; clearTimeMs: number | null } | null;
    }>(`/api/rankings/by-value/${props.seed}`);

    if (seq !== fetchSeq) return; // stale response
    rankings.value = data.ranking.map(e => ({
      rank: e.rank,
      moves: e.moveCount,
      clearTimeMs: e.clearTimeMs,
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

function goToReplay(scoreId: string) {
  emit('close');
  router.push(`/replay/${scoreId}`);
}
</script>

<template>
  <Teleport to="body">
    <div v-if="open" class="modal-overlay" @click.self="emit('close')">
      <div class="modal ranking-modal" role="dialog" aria-modal="true" aria-labelledby="ranking-title">
        <div class="modal-header">
          <div class="ranking-heading">
            <h2 id="ranking-title" class="modal-title"><img class="ranking-title-icon" :src="trophyIcon" alt="" /> {{ t('common.ranking') }}</h2>
            <span class="ranking-seed">{{ t('common.seed', { seed }) }}</span>
          </div>
          <CloseButton @click="emit('close')" />
        </div>

        <!-- Loading skeleton -->
        <template v-if="loading">
          <div class="my-rank-card skeleton-card">
            <div class="skeleton-line skeleton-short" />
            <div class="skeleton-line skeleton-wide" />
          </div>
          <div class="ranking-list">
            <div v-for="i in 5" :key="i" class="rank-row skeleton-row">
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
            <span class="my-rank-score my-rank-time">{{ formatRecordTime(myRank.clearTimeMs) }}</span>
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
            :class="['rank-row', { me: entry.isMe }]"
          >
            <span class="rank-row-num"><img v-if="rankMedalIcon(entry.rank)" :src="rankMedalIcon(entry.rank)!" class="rank-row-medal" alt="" /><template v-else>#{{ entry.rank }}</template></span>
            <span class="rank-row-name">{{ entry.playerName }}</span>
            <span class="rank-row-val">{{ t('ranking.moves', { count: entry.moves }) }}</span>
            <span class="rank-row-val rank-row-time">{{ formatRecordTime(entry.clearTimeMs) }}</span>
            <button
              v-if="entry.scoreId"
              class="icon-btn icon-btn-sm btn-replay"
              @click="goToReplay(entry.scoreId!)"
              :aria-label="t('replay.viewReplay')"
            ><img :src="playIcon" alt="" /></button>
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
/* The title and the close button stay put; only the list scrolls */
.ranking-modal {
  width: min(100%, 400px);
  max-height: min(84dvh, 700px);
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
.ranking-heading .modal-title {
  display: flex;
  align-items: center;
  gap: 6px;
  margin: 0;
}
.ranking-title-icon {
  width: 22px;
  height: 22px;
}
.ranking-seed {
  font-size: 12px;
  color: var(--text-muted);
}

/* My rank card */
.my-rank-card {
  display: flex;
  align-items: center;
  justify-content: space-between;
  background: var(--rank-highlight-bg);
  border: var(--frame-thin);
  border-radius: 14px;
  padding: 10px 16px;
  margin-bottom: 12px;
}
.my-rank-card.my-rank-empty {
  justify-content: center;
  border-style: dashed;
  background: var(--bg-card);
}
.my-rank-left {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.my-rank-label {
  font-size: 12px;
  color: var(--text-secondary);
  font-weight: 800;
}
.my-rank-num {
  font-size: 28px;
  font-weight: 800;
  color: var(--brand);
}
.my-rank-total {
  font-size: 14px;
  font-weight: 400;
  color: var(--text-muted);
}
/* 順位の基準（手数 → 時間）を同じ大きさで横に並べる */
.my-rank-right {
  display: flex;
  align-items: baseline;
  gap: 10px;
}
.my-rank-time {
  min-width: 3.5em;
  text-align: right;
}
.my-rank-score {
  font-size: 20px;
  font-weight: 700;
  color: var(--text-primary);
  font-variant-numeric: tabular-nums;
}

/* List */
.ranking-list {
  overflow-y: auto;
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
/* Rows are the shared .rank-row (theme.css); the replay button is the accent one */
.btn-replay {
  background: var(--accent);
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
