<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useI18n } from 'vue-i18n';
import { usePuzzleStore } from '@/stores/puzzle';
import { useGameStore, type GameMode } from '@/stores/game';
import { playSE, vibrate, startBGM, stopBGM, useSound } from '@/sound';
import PuzzleBoard from '@/components/PuzzleBoard.vue';
import RankingModal from '@/components/RankingModal.vue';
import ModeSelector from '@/components/ModeSelector.vue';
import SurvivalGauge from '@/components/SurvivalGauge.vue';
import DebugPanel from '@/components/DebugPanel.vue';
import { shareIcon as shareIconUrl, trophyIcon, speakerLoudIcon, speakerMutedIcon, musicNoteIcon } from '@/assets/icons';

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

// --- Sprint remaining moves overlay ---
const movesOverlayText = ref('');
const showMovesOverlay = ref(false);
let prevRemainingMoves: number | undefined;
let movesOverlayTimer: ReturnType<typeof setTimeout> | undefined;

watch(() => store.remainingMoves, (remaining) => {
  if (selectedMode.value !== 'sprint' || remaining === undefined || store.isGameOver) return;
  // Show overlay when hitting exactly 5 or entering <=3
  if ((remaining === 5 && prevRemainingMoves !== 5)
    || (remaining <= 3 && remaining < (prevRemainingMoves ?? Infinity))) {
    movesOverlayText.value = t('puzzle.movesRemaining', { remaining });
    showMovesOverlay.value = true;
    clearTimeout(movesOverlayTimer);
    movesOverlayTimer = setTimeout(() => { showMovesOverlay.value = false; }, 1200);
  }
  prevRemainingMoves = remaining;
});

// --- View phase ---
type ViewPhase = 'modeSelect' | 'playing';
const viewPhase = ref<ViewPhase>('modeSelect');
const selectedMode = ref<GameMode>('sprint');

const SESSION_KEY = 'tomado_puzzle_state';

function saveSession() {
  if (!store.gameState || store.isGameOver) return;
  try {
    sessionStorage.setItem(SESSION_KEY, JSON.stringify({
      seed: store.seed,
      mode: selectedMode.value,
      state: store.gameState,
      maxChain: store.maxChain,
      generatedItemTypes: [...store.generatedItemTypes],
      replayLog: store.replayLog,
    }));
  } catch { /* ignore quota errors */ }
}

function clearSession() {
  sessionStorage.removeItem(SESSION_KEY);
}

function tryRestoreSession(seed: number, mode: GameMode): boolean {
  try {
    const raw = sessionStorage.getItem(SESSION_KEY);
    if (!raw) return false;
    const saved = JSON.parse(raw);
    if (saved.seed !== seed || saved.mode !== mode) return false;
    const s = saved.state;
    if (!s?.board || typeof s.score !== 'number' || !Array.isArray(s.rngState)) { clearSession(); return false; }
    if (s.isGameOver) { clearSession(); return false; }
    store.restoreState(seed, s, saved.maxChain ?? 0, saved.generatedItemTypes ?? [], saved.replayLog ?? []);
    selectedMode.value = mode;
    scoreRecorded.value = false;
    viewPhase.value = 'playing';
    startBGM();
    pushGuardState();
    clearSession();
    return true;
  } catch { return false; }
}

function beginGame(seed: number, mode: GameMode) {
  clearSession();
  selectedMode.value = mode;
  store.startGame(seed, mode);
  startBGM();
  scoreRecorded.value = false;
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
  const modeQuery = route.query.mode as GameMode | undefined;

  if (!seed) {
    // No seed — go home
    router.replace('/');
    return;
  }

  if (modeQuery && ['sprint', 'clear', 'survival'].includes(modeQuery)) {
    // Try to restore an in-progress session first
    if (tryRestoreSession(seed, modeQuery)) return;
    beginGame(seed, modeQuery);
    return;
  }

  // Show mode selector
  viewPhase.value = 'modeSelect';
}

function onModeSelect(mode: GameMode) {
  const seedParam = route.params.seed;
  const seed = seedParam ? Number(seedParam) : gameStore.generateDailySeed();
  router.replace(`/puzzle/${seed}?mode=${mode}`);
  beginGame(seed, mode);
}

onMounted(() => {
  handleRoute();
  window.addEventListener('beforeunload', saveSession);
  window.addEventListener('popstate', onPopState);
});

watch(() => [route.params.seed, route.query.mode], () => {
  handleRoute();
});

// --- Record score when game ends ---
watch([() => store.isGameOver, () => store.autoActivating], ([ended, activating]) => {
  if (ended && !activating && !scoreRecorded.value && store.seed !== undefined) {
    clearSession();
    stopBGM();
    const isPositiveEnd = (selectedMode.value === 'sprint'
      && store.moveLimit !== undefined
      && store.moveCount >= store.moveLimit)
      || store.isCleared === true;
    playSE(isPositiveEnd ? 'complete' : 'game_over');
    vibrate(isPositiveEnd ? [30, 30, 50] : [50, 50, 100]);
    scoreRecorded.value = true;
    gameStore.addPlayRecord({
      seed: store.seed,
      mode: selectedMode.value,
      score: store.score,
      moves: store.moveCount,
      isCleared: store.isCleared ?? false,
      moveLimit: store.moveLimit,
      maxChain: store.maxChain,
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
const shareUrl = computed(() => shareCode.value ? `${location.origin}/s/${shareCode.value}` : null);

async function shareScore() {
  if (store.seed === undefined) return;
  const cachedCode = gameStore.getShareCode(store.seed);
  if (cachedCode) shareCode.value = cachedCode;
  const code = shareCode.value ?? `#${store.seed}`;
  const url = shareUrl.value ?? '';
  const modeLabel = t(`mode.${selectedMode.value}`);
  const text = selectedMode.value === 'clear'
    ? `Tomado ${modeLabel} ${code} | ${store.isCleared ? 'CLEARED' : 'FAILED'} ${store.moveCount}${t('mode.moves')} ${store.score.toLocaleString()}pts`
    : `Tomado ${modeLabel} ${code} | ${store.moveCount}${t('mode.moves')} ${store.score.toLocaleString()}pts`;
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
  prevRemainingMoves = undefined;
  beginGame(store.seed, selectedMode.value);
}

onUnmounted(() => {
  saveSession();
  window.removeEventListener('beforeunload', saveSession);
  window.removeEventListener('popstate', onPopState);
  stopBGM();
  clearTimeout(movesOverlayTimer);
});

// --- Ranking ---
const showRanking = ref(false);

const myBest = computed(() => {
  if (store.seed === undefined) return 0;
  return gameStore.getBestScore(store.seed, selectedMode.value);
});

const { seEnabled, bgmEnabled, toggleSE, toggleBGM } = useSound();

// --- Game over display ---
const gameOverTitle = computed(() => {
  if (selectedMode.value === 'clear') {
    return store.isCleared ? t('mode.cleared') : t('mode.failed');
  }
  if (selectedMode.value === 'sprint'
    && store.moveLimit !== undefined
    && store.moveCount >= store.moveLimit) {
    return t('mode.turnOver');
  }
  return t('puzzle.gameOver');
});

const gameOverScore = computed(() => {
  if (selectedMode.value === 'clear') {
    return store.isCleared
      ? t('mode.clearMoves', { count: store.moveCount })
      : t('mode.obstaclesLeft', { count: store.obstacleCount });
  }
  if (selectedMode.value === 'survival') {
    return t('puzzle.moveCount', { count: store.moveCount });
  }
  return t('puzzle.pts', { score: store.score });
});
</script>

<template>
  <div class="puzzle-view">
    <!-- Mode select overlay -->
    <ModeSelector
      v-if="viewPhase === 'modeSelect'"
      :seed="Number(route.params.seed) || 0"
      :open="true"
      @select="onModeSelect"
      @close="router.push('/')"
    />

    <template v-if="viewPhase === 'playing'">
      <header class="puzzle-header">
        <div class="header-row">
          <div class="seed-label">
            {{ t('puzzle.seed', { seed: store.seed }) }}
            <span class="mode-badge">{{ t(`mode.${selectedMode}`) }}</span>
            <button class="btn-ranking" @click="showRanking = true" :title="t('common.ranking')"><img :src="trophyIcon" class="btn-ranking-icon" alt="" /></button>
          </div>
          <div class="score-area">
            <template v-if="selectedMode === 'clear'">
              <div class="score-label">{{ t('mode.obstacles', { count: store.obstacleCount }) }}</div>
              <div class="move-label">{{ t('puzzle.score', { score: store.score }) }}</div>
            </template>
            <template v-else-if="selectedMode !== 'survival'">
              <div class="score-label">{{ t('puzzle.score', { score: store.score }) }}</div>
              <div v-if="myBest > 0" class="best-label">{{ t('puzzle.best', { score: myBest.toLocaleString() }) }}</div>
            </template>
          </div>
        </div>
        <div class="header-row">
          <template v-if="selectedMode === 'sprint' && store.remainingMoves !== undefined">
            <div :class="['remaining-moves', { 'remaining-urgent': store.remainingMoves <= 5 }]">
              <span class="remaining-number">{{ store.remainingMoves }}</span>
              <span class="remaining-label">{{ t('puzzle.movesRemaining', { remaining: store.remainingMoves }) }}</span>
            </div>
          </template>
          <div v-else class="move-label">
            {{ t('puzzle.moveCount', { count: store.moveCount }) }}
          </div>
        </div>
        <!-- Survival gauge -->
        <div v-if="selectedMode === 'survival' && store.quotaTarget !== undefined && store.movesUntilCheck !== undefined" class="header-row">
          <SurvivalGauge
            :current-score="store.segmentScore"
            :quota="store.quotaTarget"
            :moves-until-check="store.movesUntilCheck"
          />
        </div>
      </header>

      <div :class="['board-area', { 'board-urgent': selectedMode === 'sprint' && store.remainingMoves !== undefined && store.remainingMoves <= 5 && !store.isGameOver }]">
        <PuzzleBoard ref="puzzleBoard" :debug-panel="debugPanel" />
        <!-- Sprint remaining moves overlay -->
        <div v-if="showMovesOverlay" class="moves-overlay" :key="movesOverlayText">
          <span class="moves-overlay-text">{{ movesOverlayText }}</span>
        </div>
      </div>

      <!-- Game over overlay -->
      <div v-if="store.isGameOver && !store.autoActivating" class="game-over-overlay">
        <div class="game-over-card">
          <h2>{{ gameOverTitle }}</h2>
          <p class="final-score">{{ gameOverScore }}</p>
          <p v-if="selectedMode === 'clear'" class="clear-score-info">{{ t('puzzle.pts', { score: store.score }) }}</p>
          <p v-if="selectedMode === 'sprint'" class="move-info">{{ t('puzzle.moveCount', { count: store.moveCount }) }}</p>
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
        </div>
        <button class="btn btn-small" @click="restart">{{ t('common.retry') }}</button>
        <button v-if="isDev" class="btn btn-small btn-debug" @click="debugPanel?.show()">{{ t('puzzle.debug') }}</button>
      </footer>

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

      <RankingModal :seed="store.seed!" :open="showRanking" :mode="selectedMode" @close="showRanking = false" />
      <DebugPanel v-if="isDev" ref="debugPanel" />
    </template>
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
.mode-badge {
  background: var(--brand);
  color: #fff;
  font-size: 9px;
  font-weight: 700;
  padding: 1px 6px;
  border-radius: 4px;
  text-transform: uppercase;
  font-family: sans-serif;
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
.best-label {
  font-size: 11px;
  color: var(--text-muted);
  font-weight: 600;
}
.move-label {
  font-size: 13px;
  color: var(--text-secondary);
}
.remaining-moves {
  display: flex;
  align-items: baseline;
  gap: 6px;
  transition: color 0.3s;
}
.remaining-number {
  font-size: 28px;
  font-weight: 800;
  color: var(--brand);
  line-height: 1;
  transition: color 0.3s, transform 0.2s;
}
.remaining-label {
  font-size: 12px;
  color: var(--text-secondary);
  font-weight: 600;
}
.remaining-urgent .remaining-number {
  color: var(--danger, #f44336);
  animation: remaining-bounce 0.6s ease infinite;
}
.remaining-urgent .remaining-label {
  color: var(--danger, #f44336);
}
@keyframes remaining-bounce {
  0%, 100% { transform: scale(1); }
  50% { transform: scale(1.15); }
}
.board-urgent::after {
  content: '';
  position: absolute;
  inset: 0;
  border: 3px solid rgba(244, 67, 54, 0.5);
  border-radius: 8px;
  pointer-events: none;
  animation: board-pulse 1.2s ease-in-out infinite;
  z-index: 5;
}
@keyframes board-pulse {
  0%, 100% { opacity: 0.3; }
  50% { opacity: 1; }
}
/* Sprint remaining moves overlay */
.moves-overlay {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 8;
  pointer-events: none;
  animation: moves-overlay-anim 1.2s ease-out forwards;
}
.moves-overlay-text {
  font-size: 48px;
  font-weight: 900;
  color: var(--danger, #f44336);
  text-shadow: 0 2px 8px rgba(0,0,0,0.3), 0 0 40px rgba(244,67,54,0.3);
  letter-spacing: -1px;
}
@keyframes moves-overlay-anim {
  0% { opacity: 0; transform: scale(1.5); }
  15% { opacity: 1; transform: scale(1); }
  70% { opacity: 1; transform: scale(1); }
  100% { opacity: 0; transform: scale(0.8); }
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
  padding: 4px 8px;
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
.clear-score-info {
  font-size: 20px;
  font-weight: 700;
  color: var(--brand);
  margin-bottom: 4px;
}
.move-info {
  color: var(--text-tertiary);
  font-size: 13px;
  margin-bottom: 16px;
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
