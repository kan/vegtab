<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useI18n } from 'vue-i18n';
import { usePuzzleStore } from '@/stores/puzzle';
import { useGameStore } from '@/stores/game';
import { playSE, vibrate, startBGM, stopBGM, useSound } from '@/sound';
import { speakerLoudIcon, speakerMutedIcon, trophyIcon } from '@/assets/icons';
import PuzzleBoard from '@/components/PuzzleBoard.vue';
import RankingModal from '@/components/RankingModal.vue';
import DebugPanel from '@/components/DebugPanel.vue';
import MenuSheet from '@/components/MenuSheet.vue';
import NameDialog from '@/components/NameDialog.vue';
import { showToast } from '@/api/client';
import { buildShareUrl } from '@/utils/shareUrl';
import { isRemovedMode } from '@/lib/legacyData';
import { formatPlayTime } from '@/lib/playTime';
import { usePlayTimer } from '@/composables/usePlayTimer';

const isDev = import.meta.env.DEV;
const { t } = useI18n();

const store = usePuzzleStore();
const gameStore = useGameStore();
const route = useRoute();
const router = useRouter();
const debugPanel = ref<InstanceType<typeof DebugPanel> | null>(null);
const puzzleBoard = ref<InstanceType<typeof PuzzleBoard> | null>(null);
const scoreRecorded = ref(false);
const showNamePrompt = ref(false);

// --- View phase ---
// 'loading': 盤面を用意する前（過去日の案内を出すか、すぐ始めるかを決めるまで）
type ViewPhase = 'loading' | 'pastNotice' | 'playing';
const viewPhase = ref<ViewPhase>('loading');
const isPastPuzzle = ref(false);

// --- Play time (その日の累計。リトライをまたぐ。アニメーション中と画面を離れている間は数えない) ---
const timer = usePlayTimer(
  computed(() => store.seed),
  computed(() => viewPhase.value === 'playing' && !store.isGameOver),
  computed(() => store.animating),
);
/** クリアした時点の累計。終了画面とシェアに使う */
const clearTimeMs = ref<number | null>(null);

const SESSION_KEY = 'vegtab_puzzle_state';

function saveSession() {
  if (!store.gameState || store.isGameOver) return;
  try {
    sessionStorage.setItem(SESSION_KEY, JSON.stringify({
      seed: store.seed,
      state: store.gameState,
      generatedItemTypes: [...store.generatedItemTypes],
      replayLog: store.replayLog,
    }));
  } catch { /* ignore quota errors */ }
}

function clearSession() {
  sessionStorage.removeItem(SESSION_KEY);
}

function tryRestoreSession(seed: number): boolean {
  try {
    const raw = sessionStorage.getItem(SESSION_KEY);
    if (!raw) return false;
    const saved = JSON.parse(raw);
    if (saved.seed !== seed) return false;
    // 撤去したモードの途中経過は復元しない
    if (isRemovedMode(saved.mode)) { clearSession(); return false; }
    const s = saved.state;
    if (!s?.board || typeof s.score !== 'number' || !Array.isArray(s.rngState)) { clearSession(); return false; }
    if (s.isGameOver) { clearSession(); return false; }
    store.restoreState(seed, s, saved.generatedItemTypes ?? [], saved.replayLog ?? []);
    scoreRecorded.value = false;
    viewPhase.value = 'playing';
    startBGM();
    pushGuardState();
    clearSession();
    return true;
  } catch { return false; }
}

function beginGame(seed: number) {
  clearSession();
  store.startGame(seed);
  startBGM();
  scoreRecorded.value = false;
  clearTimeMs.value = null;
  viewPhase.value = 'playing';
  pushGuardState();
}

// --- Back navigation guard ---
// プレイ中のエッジスワイプ（戻る操作）によるページ遷移を抑止
function pushGuardState() {
  history.pushState({ puzzle: true }, '');
}

function onPopState(_e: PopStateEvent) {
  if (viewPhase.value === 'playing' && !store.isGameOver) {
    // プレイ中は戻るを無効化: ダミーエントリを再pushして留まる
    pushGuardState();
  }
}

function handleRoute() {
  const seedParam = route.params.seed;
  const seed = seedParam ? Number(seedParam) : undefined;

  if (!seed) {
    // No seed — go home
    router.replace('/');
    return;
  }

  isPastPuzzle.value = !gameStore.isTodaysDailySeed(seed);

  // Try to restore an in-progress session first
  if (tryRestoreSession(seed)) return;

  // Past puzzle: show notice before starting
  if (isPastPuzzle.value) {
    viewPhase.value = 'pastNotice';
    return;
  }

  beginGame(seed);
}

function proceedFromPastNotice() {
  beginGame(Number(route.params.seed));
}

function openPastRanking() {
  showRanking.value = true;
}

onMounted(() => {
  handleRoute();
  window.addEventListener('beforeunload', saveSession);
  window.addEventListener('popstate', onPopState);
});

watch(() => route.params.seed, () => {
  handleRoute();
});

// --- Record score when game ends ---
watch(() => store.isGameOver, (ended) => {
  if (ended && !scoreRecorded.value && store.seed !== undefined) {
    clearSession();
    stopBGM();
    const isPositiveEnd = store.isCleared === true;
    playSE(isPositiveEnd ? 'complete' : 'game_over');
    vibrate(isPositiveEnd ? [30, 30, 50] : [50, 50, 100]);
    scoreRecorded.value = true;
    clearTimeMs.value = isPositiveEnd ? Math.round(timer.now()) : null;
    gameStore.addPlayRecord({
      seed: store.seed,
      score: store.score,
      moves: store.moveCount,
      isCleared: store.isCleared ?? false,
      clearTimeMs: clearTimeMs.value,
      generatedItemTypes: [...store.generatedItemTypes],
      replayLog: [...store.replayLog],
    });
    // Prompt for name if not set
    if (!gameStore.displayName) showNamePrompt.value = true;
  }
});

// --- Share ---
const shareCode = ref<string | null>(null);
const shareUrl = computed(() => shareCode.value ? buildShareUrl(shareCode.value) : null);

async function shareScore() {
  if (store.seed === undefined) return;
  const cachedCode = gameStore.getShareCode(store.seed);
  if (cachedCode) shareCode.value = cachedCode;
  const code = shareCode.value ?? `#${store.seed}`;
  const url = shareUrl.value ?? '';
  const appName = t('common.appName');
  const moves = `${store.moveCount}${t('mode.moves')}`;
  const result = clearTimeMs.value !== null ? `CLEARED ${moves} ${formatPlayTime(clearTimeMs.value)}` : `FAILED ${moves}`;
  const text = `${appName} ${code} | ${result}`;
  const shareData: ShareData = { text };
  if (url) shareData.url = url;
  if (navigator.share) {
    try {
      await navigator.share(shareData);
    } catch { /* user cancelled */ }
  } else {
    await navigator.clipboard.writeText(url ? `${text}\n${url}` : text);
    showToast('success', 'common.copiedToClipboard');
  }
}

function restart() {
  beginGame(store.seed);
}

onUnmounted(() => {
  saveSession();
  window.removeEventListener('beforeunload', saveSession);
  window.removeEventListener('popstate', onPopState);
  stopBGM();
});

// --- Ranking ---
const showRanking = ref(false);
const rankingSeed = computed(() => store.seed || Number(route.params.seed) || 0);

// Under the board only what is used while playing; BGM and the animation speed are in the settings
const { seEnabled, toggleSE } = useSound();

// --- Game over display ---
const peekingBoard = ref(false);

const gameOverTitle = computed(() => store.isCleared ? t('mode.cleared') : t('mode.failed'));

const gameOverScore = computed(() => store.isCleared
  ? t('mode.clearMoves', { count: store.moveCount })
  : t('mode.obstaclesLeft', { count: store.obstacleCount }));
</script>

<template>
  <div class="puzzle-view">
    <!-- Past puzzle notice -->
    <Teleport to="body">
      <div v-if="viewPhase === 'pastNotice'" class="modal-overlay">
        <div class="modal">
          <h3 class="modal-title">{{ t('puzzle.pastNoticeTitle') }}</h3>
          <p class="modal-desc">{{ t('puzzle.pastNoticeMessage') }}</p>
          <div class="modal-actions">
            <button class="modal-btn-primary" @click="proceedFromPastNotice">{{ t('puzzle.pastNoticePlay') }}</button>
            <button class="modal-btn-secondary" @click="openPastRanking">{{ t('common.ranking') }}</button>
            <button class="modal-btn-secondary" @click="router.push('/')">{{ t('common.home') }}</button>
          </div>
        </div>
      </div>
    </Teleport>

    <template v-if="viewPhase === 'playing'">
      <!-- Status line and the menu, as TAKO-SEN's top line -->
      <header class="puzzle-header">
        <dl class="status">
          <div class="status-item status-obstacles">
            <dt>{{ t('puzzle.statusObstacles') }}</dt>
            <dd>{{ store.obstacleCount }}</dd>
          </div>
          <div class="status-item">
            <dt>{{ t('puzzle.statusMoves') }}</dt>
            <dd>{{ store.moveCount }}</dd>
          </div>
          <div class="status-item">
            <dt>{{ t('puzzle.statusTime') }}</dt>
            <dd class="status-time">{{ formatPlayTime(timer.elapsedMs.value) }}</dd>
          </div>
        </dl>
        <MenuSheet :account="false" />
      </header>
      <p class="puzzle-sub">
        {{ t('puzzle.seed', { seed: store.seed }) }}
        <span class="puzzle-score">{{ t('puzzle.score', { score: store.score }) }}</span>
      </p>

      <div class="board-area">
        <PuzzleBoard ref="puzzleBoard" :debug-panel="debugPanel" />
      </div>

      <!-- Game over overlay -->
      <div
        v-if="store.isGameOver"
        class="game-over-overlay"
        :class="{ 'game-over-peek': peekingBoard }"
        @pointerdown.self="peekingBoard = true"
        @pointerup.self="peekingBoard = false"
        @pointerleave="peekingBoard = false"
      >
        <div class="modal game-over-card">
          <h2 :class="{ failed: !store.isCleared }">{{ gameOverTitle }}</h2>
          <p class="final-score">{{ gameOverScore }}</p>
          <p v-if="clearTimeMs !== null" class="clear-time-info">{{ formatPlayTime(clearTimeMs) }}</p>
          <p class="score-info">{{ t('puzzle.pts', { score: store.score }) }}</p>
          <div class="game-over-actions">
            <!-- The result leads straight to where it ranks -->
            <button class="btn btn-primary" @click="showRanking = true">
              <img :src="trophyIcon" class="btn-img" alt="" /> {{ t('puzzle.seeRanking') }}
            </button>
            <button class="btn" @click="restart">{{ t('common.retry') }}</button>
            <button class="btn" @click="shareScore">{{ t('common.share') }}</button>
            <button class="btn" @click="router.push('/')">{{ t('common.home') }}</button>
          </div>
        </div>
      </div>

      <!-- Under the board: what is used while playing, as TAKO-SEN's round buttons -->
      <footer class="puzzle-footer">
        <button class="icon-btn icon-btn-next" :aria-label="t('common.retry')" @click="restart">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M4 12a8 8 0 1 0 2.6-5.9" /><path d="M4 4v5h5" /></svg>
        </button>
        <button class="icon-btn" :aria-label="t('home.soundSE')" :aria-pressed="seEnabled" @click="toggleSE">
          <img :src="seEnabled ? speakerLoudIcon : speakerMutedIcon" alt="" />
        </button>
        <button class="icon-btn" :aria-label="t('common.ranking')" @click="showRanking = true">
          <img :src="trophyIcon" alt="" />
        </button>
        <button v-if="isDev" class="btn btn-debug" @click="debugPanel?.show()">{{ t('puzzle.debug') }}</button>
      </footer>


      <NameDialog :open="showNamePrompt" @close="showNamePrompt = false" />
      <DebugPanel v-if="isDev" ref="debugPanel" />
    </template>

    <RankingModal :seed="rankingSeed" :open="showRanking" @close="showRanking = false" />
  </div>
</template>

<style scoped>
.puzzle-view {
  flex: 1;
  display: flex;
  flex-direction: column;
  padding: 10px 12px 12px;
  overflow: hidden;
  position: relative;
}
.puzzle-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  min-height: 44px;
}
.status {
  display: flex;
  gap: 18px;
  margin: 0;
}
.status-item {
  display: flex;
  align-items: baseline;
  gap: 4px;
}
.status-item dt {
  font-size: 13px;
  font-weight: 800;
  color: var(--text-secondary);
}
.status-item dd {
  margin: 0;
  font-size: 22px;
  font-weight: 800;
  font-variant-numeric: tabular-nums;
}
.status-obstacles dd {
  color: var(--brand);
}
.status-time {
  min-width: 3.2em;
}
.puzzle-sub {
  display: flex;
  justify-content: space-between;
  margin: 0 0 8px;
  font-size: 12px;
  color: var(--text-muted);
}
.score-info {
  font-size: 13px;
  color: var(--text-muted);
  margin: 0 0 14px;
}
.btn-img {
  width: 20px;
  height: 20px;
}
.board-area {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  position: relative;
}
.puzzle-footer {
  display: flex;
  gap: 12px;
  justify-content: center;
  align-items: center;
  padding: 12px 0 0;
}
/* Retry stands out in the kan-game.app "next" orange, as TAKO-SEN's skip */
.icon-btn-next {
  background: var(--accent-next);
}
.icon-btn[aria-pressed="false"] img {
  opacity: 0.5;
}
.btn-debug {
  min-height: 36px;
  padding: 4px 12px;
  font-size: 12px;
}
.clear-time-info {
  font-size: 22px;
  font-weight: 800;
  font-variant-numeric: tabular-nums;
  color: var(--text-secondary);
  margin: 0 0 4px;
}
.game-over-overlay {
  position: absolute;
  inset: 0;
  background: var(--overlay-bg);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 10;
}
.game-over-peek {
  background: transparent;
}
.game-over-peek .game-over-card {
  opacity: 0;
  pointer-events: none;
}
/* A .modal over the board only (the overlay is the board area's, so the board can be peeked) */
.game-over-card {
  width: min(100% - 24px, 320px);
  border-radius: 24px;
  padding: 24px 20px;
  text-align: center;
}
.game-over-card h2 {
  font-size: 30px;
  font-weight: 800;
  color: var(--brand);
  margin: 0 0 4px;
}
.game-over-card h2.failed {
  color: var(--danger);
}
.final-score {
  font-size: 26px;
  font-weight: 800;
  color: var(--ink);
  margin: 0 0 2px;
}
.game-over-actions {
  display: grid;
  gap: 10px;
}
</style>
