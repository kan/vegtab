<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted } from 'vue';
import { useRouter } from 'vue-router';
import { useI18n } from 'vue-i18n';
import { useGameStore } from '@/stores/game';
import { showToast, api } from '@/api/client';
import NameDialog from '@/components/NameDialog.vue';
import MenuSheet from '@/components/MenuSheet.vue';
import { useSound } from '@/sound';
import { useCalendar } from '@/composables/useCalendar';
import { todayJST, nextMidnightJST } from '@/utils/date';
import { isTutorialFirstVisit, markTutorialSeen } from '@/tutorial/progress';
import RankingModal from '@/components/RankingModal.vue';
import { formatRecordTime } from '@/lib/playTime';
import { rankMedalIcon } from '@/lib/rankMedal';
import { getUserId } from '@/api/id';
import { trophyIcon } from '@/assets/icons';
import VegetableIcon from '@/components/VegetableIcon.vue';

const { t } = useI18n();
const router = useRouter();
const gameStore = useGameStore();
const { soundPromptNeeded, acceptSound, declineSound } = useSound();

// Title vegetable icon (random)
const titleVege = Math.floor(Math.random() * 5) as 0 | 1 | 2 | 3 | 4;

const showNameDialog = ref(false);

// Ranking modal
const showRanking = ref(false);

// --- Today's daily ---
const today = ref(todayJST());
const todaySeed = computed(() => gameStore.generateDailySeed(today.value));

/** This device's best result of today: cleared first, then fewest moves, then the shortest time */
const todayBest = computed(() => gameStore.getBestResult(todaySeed.value));

function playToday() {
  router.push(`/puzzle/${todaySeed.value}`);
}

// --- Daily help ---
const showDailyHelp = ref(false);

// --- Calendar ---
const cal = useCalendar();
const showCalendar = ref(false);

function playCalendarSeed(dateStr: string, seed: number) {
  if (dateStr > today.value) return;
  router.push(`/puzzle/${seed}`);
}

function isToday(dateStr: string): boolean {
  return dateStr === today.value;
}

function isFuture(dateStr: string): boolean {
  return dateStr > today.value;
}

// --- Tutorial first visit ---
const showTutorialPrompt = ref(false);

function acceptTutorial() {
  showTutorialPrompt.value = false;
  router.push('/tutorial');
}

function declineTutorial() {
  showTutorialPrompt.value = false;
  markTutorialSeen();
}

// --- Daily countdown (time until JST midnight) ---
const countdown = ref('');
let countdownTimer: ReturnType<typeof setInterval> | undefined;

function updateCountdown() {
  const diff = nextMidnightJST() - Date.now();
  if (diff <= 0) {
    // Midnight passed — refresh daily seed
    const newToday = todayJST();
    if (newToday !== today.value) {
      today.value = newToday;
      showToast('info', 'home.newDailyReady');
      fetchRankingPreview();
    }
    countdown.value = '00:00:00';
    return;
  }
  const h = Math.floor(diff / 3600000);
  const m = Math.floor((diff % 3600000) / 60000);
  const s = Math.floor((diff % 60000) / 1000);
  countdown.value = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

// --- Ranking preview (from API): the top few and this ID's place ---
const PREVIEW_ENTRIES = 3;
const rankingPreview = ref<Array<{ rank: number; playerName: string; moves: number; clearTimeMs: number | null; isMe: boolean }>>([]);
const myRank = ref<number | null>(null);
const rankingLoading = ref(false);

let previewSeq = 0;

async function fetchRankingPreview() {
  const seq = ++previewSeq;
  rankingLoading.value = true;
  try {
    const data = await api<{
      ranking: Array<{ rank: number; userId: string; displayName: string; moveCount: number; clearTimeMs: number | null }>;
      userRank: { rank: number } | null;
    }>(`/api/rankings/by-value/${todaySeed.value}`);
    if (seq !== previewSeq) return;
    const me = getUserId();
    rankingPreview.value = data.ranking.slice(0, PREVIEW_ENTRIES).map(e => ({
      rank: e.rank,
      playerName: e.displayName,
      moves: e.moveCount,
      clearTimeMs: e.clearTimeMs,
      isMe: e.userId === me,
    }));
    myRank.value = data.userRank?.rank ?? null;
  } catch {
    if (seq !== previewSeq) return;
    rankingPreview.value = [];
    myRank.value = null;
  }
  rankingLoading.value = false;
}

onMounted(() => {
  updateCountdown();
  countdownTimer = setInterval(updateCountdown, 1000);
  if (isTutorialFirstVisit()) showTutorialPrompt.value = true;
  fetchRankingPreview();
});

// A transfer code switches the ID, and naming it puts its records in the ranking (getUserId reads a ref)
watch(() => [getUserId(), gameStore.displayName], () => fetchRankingPreview());

onUnmounted(() => {
  clearInterval(countdownTimer);
});
</script>

<template>
  <div class="home-view">
    <header class="home-header">
      <h1 class="app-title">
        <VegetableIcon :color="titleVege" :size="30" />
        {{ t('common.appName') }}
      </h1>
      <MenuSheet />
    </header>

    <!-- Today's daily: the main thing on HOME -->
    <section class="card today-card">
      <div class="today-head">
        <div>
          <p class="today-label">{{ t('home.dailyPuzzle') }}</p>
          <p class="today-date">{{ today }}</p>
        </div>
        <button class="icon-btn icon-btn-sm help-btn" :aria-label="t('home.dailyHelpLabel')" @click="showDailyHelp = !showDailyHelp">?</button>
      </div>
      <p v-if="showDailyHelp" class="daily-help-box">{{ t('home.dailyHelp') }}</p>

      <div class="today-status">
        <template v-if="todayBest?.isCleared">
          <p class="status-cleared">{{ t('home.todayCleared') }}</p>
          <p class="status-best">
            <span class="best-moves">{{ t('ranking.moves', { count: todayBest.moves }) }}</span>
            <span class="best-time">{{ formatRecordTime(todayBest.timeMs) }}</span>
            <span v-if="myRank" class="best-rank">{{ t('home.myRank', { rank: myRank }) }}</span>
          </p>
        </template>
        <p v-else class="status-goal">{{ todayBest ? t('home.notClearedYet') : t('home.clearGoal') }}</p>
      </div>

      <button class="btn btn-primary play-btn" @click="playToday">
        {{ todayBest ? t('home.playAgain') : t('common.play') }}
      </button>

      <p class="today-meta">
        {{ t('home.nextPuzzleIn') }} <span class="countdown-time">{{ countdown }}</span>
        <span class="today-seed">{{ t('common.seed', { seed: todaySeed }) }}</span>
      </p>
    </section>

    <!-- Ranking preview -->
    <section class="card ranking-card">
      <h2 class="section-title ranking-heading"><img class="ranking-title-icon" :src="trophyIcon" alt="" /> {{ t('home.rankingPreview') }}</h2>
      <!-- The same rows as the ranking dialog (RankingModal.vue): medals for 1 to 3, this ID's row framed -->
      <div class="ranking-list">
        <template v-if="rankingLoading">
          <div v-for="i in PREVIEW_ENTRIES" :key="i" class="rank-row">
            <span class="skeleton-block skeleton-rank" />
            <span class="skeleton-block skeleton-name" />
            <span class="skeleton-block skeleton-val" />
          </div>
        </template>
        <template v-else-if="rankingPreview.length > 0">
          <div v-for="(entry, i) in rankingPreview" :key="i" :class="['rank-row', { me: entry.isMe }]">
            <span class="rank-row-num">
              <img v-if="rankMedalIcon(entry.rank)" :src="rankMedalIcon(entry.rank)!" class="rank-row-medal" alt="" />
              <template v-else>#{{ entry.rank }}</template>
            </span>
            <span class="rank-row-name">{{ entry.playerName }}</span>
            <span class="rank-row-val">{{ t('ranking.moves', { count: entry.moves }) }}</span>
            <span class="rank-row-val rank-row-time">{{ formatRecordTime(entry.clearTimeMs) }}</span>
          </div>
        </template>
        <p v-else class="ranking-empty">{{ t('common.noRecords') }}</p>
      </div>
      <button class="btn see-ranking" @click="showRanking = true">{{ t('home.seeRanking') }}</button>
      <button v-if="!gameStore.displayName" class="name-link" @click="showNameDialog = true">{{ t('home.joinRanking') }}</button>
    </section>

    <!-- Calendar -->
    <section class="card calendar-card">
      <button class="calendar-toggle" :aria-expanded="showCalendar" @click="showCalendar = !showCalendar">
        <h2 class="section-title">{{ t('home.pastDailySeeds') }}</h2>
        <span class="toggle-arrow" aria-hidden="true">{{ showCalendar ? '▲' : '▼' }}</span>
      </button>
      <div v-if="showCalendar" class="calendar">
        <div class="calendar-header">
          <button class="icon-btn icon-btn-sm" @click="cal.prevMonth">&lt;</button>
          <span class="cal-month">{{ cal.monthLabel.value }}</span>
          <button class="icon-btn icon-btn-sm" :disabled="cal.isCurrentMonth.value" @click="cal.nextMonth">&gt;</button>
        </div>
        <div class="calendar-weekdays">
          <span v-for="d in ['sun','mon','tue','wed','thu','fri','sat']" :key="d" class="cal-weekday">{{ t(`weekdays.${d}`) }}</span>
        </div>
        <div class="calendar-grid">
          <div
            v-for="(cell, i) in cal.grid.value"
            :key="i"
            :class="[
              'cal-cell',
              {
                empty: !cell,
                today: cell && isToday(cell.date),
                future: cell && isFuture(cell.date),
                played: cell && !isFuture(cell.date) && gameStore.hasPlayedDaily(cell.date),
              },
            ]"
            @click="cell && !isFuture(cell.date) && playCalendarSeed(cell.date, cell.seed)"
          >
            <template v-if="cell">
              <span class="cal-day">{{ parseInt(cell.date.slice(8)) }}</span>
              <span v-if="!isFuture(cell.date) && cal.bestMoves(cell.seed) > 0" class="cal-score">{{ t('ranking.moves', { count: cal.bestMoves(cell.seed) }) }}</span>
              <span v-else-if="!isFuture(cell.date) && gameStore.hasPlayedDaily(cell.date)" class="cal-played-dot" />
            </template>
          </div>
        </div>
      </div>
    </section>


    <!-- Sound prompt modal (first visit) -->
    <Teleport to="body">
      <div v-if="soundPromptNeeded" class="modal-overlay">
        <div class="modal">
          <h3 class="modal-title">{{ t('home.soundPromptTitle') }}</h3>
          <p class="modal-desc">{{ t('home.soundPromptMessage') }}</p>
          <div class="modal-actions">
            <button class="modal-btn-primary" @click="acceptSound()">{{ t('home.soundPromptYes') }}</button>
            <button class="modal-btn-secondary" @click="declineSound()">{{ t('home.soundPromptNo') }}</button>
          </div>
        </div>
      </div>
    </Teleport>

    <!-- Tutorial first visit prompt -->
    <Teleport to="body">
      <div v-if="showTutorialPrompt" class="modal-overlay">
        <div class="modal">
          <h3 class="modal-title">{{ t('tutorial.firstVisitTitle') }}</h3>
          <p class="modal-desc">{{ t('tutorial.firstVisitMessage') }}</p>
          <div class="modal-actions">
            <button class="modal-btn-primary" @click="acceptTutorial">{{ t('tutorial.firstVisitYes') }}</button>
            <button class="modal-btn-secondary" @click="declineTutorial">{{ t('tutorial.firstVisitNo') }}</button>
          </div>
        </div>
      </div>
    </Teleport>

    <RankingModal :seed="todaySeed" :open="showRanking" @close="showRanking = false" />
    <NameDialog :open="showNameDialog" @close="showNameDialog = false" />
  </div>
</template>

<style scoped>
.home-view {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 14px;
  padding: 10px 12px 20px;
  overflow-y: auto;
}

/* Header: the title and the menu, as TAKO-SEN's top line */
.home-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  min-height: 44px;
}
.app-title {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 0;
  font-size: 24px;
  font-weight: 800;
  color: var(--title-color);
}

.section-title {
  margin: 0;
  font-size: 15px;
  font-weight: 800;
  color: var(--ink);
}

/* Today */
.today-card {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.today-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 8px;
}
.today-label {
  margin: 0;
  font-size: 14px;
  font-weight: 800;
  color: var(--text-secondary);
}
.today-date {
  margin: 0;
  font-size: 26px;
  font-weight: 800;
  line-height: 1.2;
}
.help-btn,
.calendar-header .icon-btn {
  font-weight: 800;
}
.daily-help-box {
  margin: 0;
  padding: 10px 12px;
  border-radius: 12px;
  background: var(--bg-card-alt);
  font-size: 14px;
  color: var(--text-secondary);
}
.today-status {
  text-align: center;
}
.status-goal {
  margin: 0;
  font-size: 16px;
  font-weight: 800;
}
.status-cleared {
  margin: 0;
  font-size: 15px;
  font-weight: 800;
  color: var(--brand);
}
.status-best {
  display: flex;
  justify-content: center;
  align-items: baseline;
  gap: 12px;
  margin: 2px 0 0;
}
.best-moves {
  font-size: 30px;
  font-weight: 800;
}
.best-time {
  font-size: 18px;
  font-weight: 800;
  font-variant-numeric: tabular-nums;
  color: var(--text-secondary);
}
.best-rank {
  font-size: 15px;
  font-weight: 800;
  padding: 0 10px;
  border-radius: 999px;
  background: var(--accent);
}
.play-btn {
  width: 100%;
  min-height: 56px;
  font-size: 20px;
}
.today-meta {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 4px 12px;
  margin: 0;
  font-size: 13px;
  color: var(--text-muted);
}
.countdown-time {
  font-weight: 800;
  font-variant-numeric: tabular-nums;
  color: var(--text-secondary);
}

/* Ranking preview */
.ranking-card {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.ranking-heading {
  display: flex;
  align-items: center;
  gap: 6px;
}
.ranking-title-icon {
  width: 20px;
  height: 20px;
}
.ranking-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.ranking-empty {
  margin: 0;
  font-size: 14px;
  color: var(--text-muted);
}
.see-ranking {
  margin-top: 4px;
}
.name-link {
  border: 0;
  background: none;
  color: var(--brand);
  font-size: 14px;
  font-weight: 800;
  text-decoration: underline;
  cursor: pointer;
}
.skeleton-block { display: inline-block; height: 12px; }
.skeleton-rank { width: 16px; }
.skeleton-name { flex: 1; }
.skeleton-val { width: 40px; }

/* Calendar */
.calendar-card {
  padding: 12px 16px;
}
.calendar-toggle {
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: 100%;
  min-height: 32px;
  padding: 0;
  border: 0;
  background: none;
  color: var(--ink);
  cursor: pointer;
}
.toggle-arrow {
  font-size: 12px;
}
.calendar {
  margin-top: 10px;
}
.calendar-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 8px;
}
.cal-month {
  font-weight: 800;
  font-size: 15px;
}
.calendar-weekdays,
.calendar-grid {
  display: grid;
  grid-template-columns: repeat(7, 1fr);
  gap: 3px;
}
.calendar-weekdays {
  margin-bottom: 4px;
}
.cal-weekday {
  text-align: center;
  font-size: 11px;
  font-weight: 800;
  color: var(--text-muted);
}
.cal-cell {
  aspect-ratio: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  border-radius: 8px;
  cursor: pointer;
  position: relative;
}
.cal-cell.empty {
  cursor: default;
}
.cal-cell.future {
  opacity: 0.3;
  cursor: default;
}
.cal-cell.played {
  background: var(--cal-played);
}
.cal-cell.today {
  background: var(--cal-today);
  outline: 2px solid var(--ink);
  outline-offset: -2px;
  font-weight: 800;
}
@media (hover: hover) {
  .cal-cell:not(.empty):not(.future):hover {
    background: var(--bg-hover);
  }
}
.cal-day {
  font-size: 13px;
}
.cal-score {
  font-size: 8px;
  color: var(--brand);
  font-weight: 800;
  position: absolute;
  bottom: 1px;
}
.cal-played-dot {
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: var(--brand);
  opacity: 0.6;
  position: absolute;
  bottom: 3px;
}
</style>
