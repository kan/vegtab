<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useI18n } from 'vue-i18n';
import { usePuzzleStore } from '@/stores/puzzle';
import { useGameStore } from '@/stores/game';
import { playSE, vibrate, startBGM, stopBGM, useSound } from '@/sound';
import { useAnim } from '@/anim';
import { speakerLoudIcon, speakerMutedIcon, musicNoteIcon, speedIcon } from '@/assets/icons';
import PuzzleBoard from '@/components/PuzzleBoard.vue';
import RankingModal from '@/components/RankingModal.vue';
import DebugPanel from '@/components/DebugPanel.vue';
import SettingsModal from '@/components/SettingsModal.vue';
import { shareIcon as shareIconUrl, trophyIcon } from '@/assets/icons';
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
const nameInput = ref('');

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
    if (!gameStore.displayName) {
      showNamePrompt.value = true;
      nameInput.value = '';
    }
  }
});

function saveNameAndDismiss() {
  const name = nameInput.value.trim();
  if (name) gameStore.setDisplayName(name);
  showNamePrompt.value = false;
}

function skipNamePrompt() {
  showNamePrompt.value = false;
}

// --- Share ---
const shareToast = ref(false);
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
    shareToast.value = true;
    setTimeout(() => { shareToast.value = false; }, 2000);
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

const { seEnabled, bgmEnabled, toggleSE, toggleBGM } = useSound();
const { animSpeed, cycleSpeed } = useAnim();
const showSettings = ref(false);

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
      <header class="puzzle-header">
        <div class="header-row">
          <div class="seed-label">
            {{ t('puzzle.seed', { seed: store.seed }) }}
            <button class="btn-ranking" @click="showRanking = true" :title="t('common.ranking')"><img :src="trophyIcon" class="btn-ranking-icon" alt="" /></button>
          </div>
          <div class="score-area">
            <div class="score-label">{{ t('mode.obstacles', { count: store.obstacleCount }) }}</div>
            <div class="move-label">{{ t('puzzle.score', { score: store.score }) }}</div>
          </div>
        </div>
        <div class="header-row">
          <div class="move-label">
            {{ t('puzzle.moveCount', { count: store.moveCount }) }}
          </div>
          <div class="move-label time-label">{{ t('puzzle.time', { time: formatPlayTime(timer.elapsedMs.value) }) }}</div>
        </div>
      </header>

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
        <div class="game-over-card">
          <h2>{{ gameOverTitle }}</h2>
          <p class="final-score">{{ gameOverScore }}</p>
          <p v-if="clearTimeMs !== null" class="clear-time-info">{{ t('puzzle.time', { time: formatPlayTime(clearTimeMs) }) }}</p>
          <p class="score-info">{{ t('puzzle.pts', { score: store.score }) }}</p>
          <div class="game-over-actions actions-col">
            <button class="btn" @click="restart"><span class="btn-icon">&#x21BB;</span> {{ t('common.retry') }}</button>
            <button class="btn btn-share" @click="shareScore"><img :src="shareIconUrl" class="btn-icon-svg" alt="" /> {{ t('common.share') }}</button>
            <button class="btn btn-home" @click="router.push('/')"><span class="btn-icon">&#x2302;</span> {{ t('common.home') }}</button>
          </div>
        </div>
      </div>

      <footer class="puzzle-footer">
        <div class="footer-sound">
          <button :class="['sound-toggle', { off: !seEnabled }]" @click="toggleSE" :title="t('home.soundSE')">
            <img :src="seEnabled ? speakerLoudIcon : speakerMutedIcon" class="sound-icon" alt="" />
          </button>
          <button :class="['sound-toggle', { off: !bgmEnabled }]" @click="toggleBGM" :title="t('home.soundBGM')">
            <img :src="musicNoteIcon" class="sound-icon" alt="" />
          </button>
          <button class="sound-toggle speed-toggle" @click="cycleSpeed" :title="t('home.animSpeed')">
            <img :src="speedIcon" class="sound-icon" alt="" />
            <span class="speed-label">{{ animSpeed }}x</span>
          </button>
        </div>
        <button class="btn btn-small" @click="restart">{{ t('common.retry') }}</button>
        <button v-if="isDev" class="btn btn-small btn-debug" @click="debugPanel?.show()">{{ t('puzzle.debug') }}</button>
      </footer>

      <!-- Settings gear button (fixed, bottom-right) -->
      <button class="gear-fab" @click="showSettings = true" :title="t('home.settingsTitle')">
        <svg class="gear-fab-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
      </button>

      <!-- Share toast -->
      <div v-if="shareToast" class="share-toast">{{ t('common.copiedToClipboard') }}</div>

      <!-- Name prompt modal -->
      <Teleport to="body">
        <div v-if="showNamePrompt" class="modal-overlay">
          <div class="modal">
            <h3 class="modal-title">{{ t('puzzle.namePromptTitle') }}</h3>
            <p class="modal-desc">{{ t('puzzle.namePromptMessage') }}</p>
            <input
              v-model="nameInput"
              class="name-prompt-input"
              maxlength="20"
              :placeholder="t('home.namePlaceholder')"
              @keyup.enter="saveNameAndDismiss"
            />
            <div class="modal-actions">
              <button class="modal-btn-primary" :disabled="!nameInput.trim()" @click="saveNameAndDismiss">{{ t('common.ok') }}</button>
              <button class="modal-btn-secondary" @click="skipNamePrompt">{{ t('puzzle.namePromptLater') }}</button>
            </div>
          </div>
        </div>
      </Teleport>

      <SettingsModal :open="showSettings" @close="showSettings = false" />
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
  padding: 12px;
  overflow: hidden;
  position: relative;
}
.puzzle-header {
  margin-bottom: 12px;
}
.header-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 4px;
}
.seed-label {
  font-size: 11px;
  color: var(--text-tertiary);
  font-family: monospace;
  display: flex;
  align-items: center;
  gap: 4px;
}
.btn-ranking {
  background: none;
  border: none;
  cursor: pointer;
  padding: 0 2px;
}
.btn-ranking-icon {
  width: 18px;
  height: 18px;
  vertical-align: middle;
}
.score-area {
  text-align: right;
}
.score-label {
  font-size: 20px;
  font-weight: 700;
  color: var(--brand);
}
.move-label {
  font-size: 13px;
  color: var(--text-secondary);
}
.time-label {
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}
.score-info {
  font-size: 13px;
  color: var(--text-muted);
  margin-bottom: 12px;
}
.btn-icon {
  margin-right: 4px;
}
.btn-icon-svg {
  width: 16px;
  height: 16px;
  vertical-align: -2px;
  margin-right: 4px;
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
  gap: 8px;
  justify-content: center;
  align-items: center;
  padding: 12px 0 0;
}
.footer-sound {
  display: flex;
  gap: 4px;
}
.sound-toggle {
  padding: 6px 10px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--bg-card);
  cursor: pointer;
  display: flex;
  align-items: center;
}
.sound-icon {
  width: 18px;
  height: 18px;
}
.sound-toggle.off {
  opacity: 0.4;
}
.speed-toggle {
  gap: 2px;
}
.speed-label {
  font-size: 10px;
  font-weight: 700;
  color: var(--brand);
  line-height: 1;
}
.gear-fab {
  position: fixed;
  bottom: 80px;
  right: max(16px, calc((100vw - 480px) / 2 + 16px));
  width: 44px;
  height: 44px;
  border-radius: 50%;
  border: 1px solid var(--border);
  background: var(--bg-card);
  box-shadow: var(--shadow-card);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 50;
}
.gear-fab-icon {
  width: 22px;
  height: 22px;
  color: var(--text-secondary);
}
.btn {
  padding: 10px 24px;
  border: none;
  border-radius: 6px;
  font-weight: 600;
  cursor: pointer;
  background: var(--brand);
  color: #fff;
  font-size: 14px;
}
.btn-secondary {
  background: var(--secondary);
}
.btn-share {
  background: var(--info);
}
.btn-home {
  background: var(--bg-card);
  color: var(--text-secondary);
  border: 1px solid var(--border);
}
.share-toast {
  position: fixed;
  bottom: 80px;
  left: 50%;
  transform: translateX(-50%);
  background: rgba(0, 0, 0, 0.8);
  color: #fff;
  padding: 8px 20px;
  border-radius: 20px;
  font-size: 13px;
  z-index: 2000;
}
.btn-small {
  padding: 6px 16px;
  font-size: 12px;
}
.btn-debug {
  background: var(--slate);
}
.clear-time-info {
  font-size: 20px;
  font-weight: 700;
  color: var(--brand);
  margin-bottom: 4px;
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
.game-over-card {
  background: var(--bg-card);
  border-radius: 12px;
  padding: 32px;
  text-align: center;
  box-shadow: var(--shadow-modal);
}
.game-over-card h2 {
  font-size: 24px;
  color: var(--brand);
  margin-bottom: 8px;
}
.final-score {
  font-size: 36px;
  font-weight: 700;
  color: var(--text-primary);
  margin-bottom: 8px;
}
.game-over-actions {
  display: flex;
  gap: 12px;
  justify-content: center;
}
.actions-col {
  flex-direction: column;
  gap: 10px;
}
/* Name prompt modal */
.modal-overlay {
  position: fixed;
  inset: 0;
  background: var(--overlay-bg);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
}
.modal {
  background: var(--bg-card);
  border-radius: 16px;
  padding: 24px;
  width: 320px;
  max-width: 90vw;
}
.modal-title {
  font-size: 18px;
  font-weight: 700;
  color: var(--text-primary);
  margin: 0 0 4px;
}
.modal-desc {
  font-size: 12px;
  color: var(--text-muted);
  margin: 0 0 16px;
}
.modal-actions {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.modal-btn-primary {
  padding: 12px;
  border: none;
  border-radius: 8px;
  background: var(--brand);
  color: #fff;
  font-weight: 600;
  font-size: 15px;
  cursor: pointer;
}
.modal-btn-primary:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}
.modal-btn-secondary {
  padding: 12px;
  border: none;
  border-radius: 8px;
  background: none;
  color: var(--text-muted);
  font-weight: 600;
  font-size: 15px;
  cursor: pointer;
}
.name-prompt-input {
  width: 100%;
  padding: 10px 12px;
  border: 1px solid var(--border);
  border-radius: 8px;
  font-size: 16px;
  text-align: center;
  background: var(--bg-input);
  color: var(--text-primary);
  margin-bottom: 12px;
  box-sizing: border-box;
}
</style>
