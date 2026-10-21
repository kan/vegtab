<script setup lang="ts">
import { ref, computed } from 'vue';
import { useRouter } from 'vue-router';
import { useI18n } from 'vue-i18n';
import { useTutorialPlayer } from '@/composables/useTutorialPlayer';
import { useAchievementStore } from '@/stores/achievements';
import { api } from '@/api/client';
import { tutorialSections, allTutorialSteps } from '@/data/tutorialSteps';
import TutorialBoard from '@/components/TutorialBoard.vue';

const isDev = import.meta.env.DEV;
const { t } = useI18n();
const router = useRouter();
const player = useTutorialPlayer();

function skip() {
  player.markCompleted();
  router.push('/');
}

function finish() {
  player.markCompleted();

  // Unlock "tutorial_complete" achievement
  const achievementStore = useAchievementStore();
  const already = achievementStore.getState('tutorial_complete');
  if (!already?.isUnlocked) {
    achievementStore.handleNewAchievements(['tutorial_complete']);
    // Persist to server (fire-and-forget)
    api('/api/achievements/unlock', {
      method: 'POST',
      body: JSON.stringify({ type: 'tutorial_complete' }),
    }).catch(() => { /* offline — will be in localStorage */ });
  }

  router.push('/');
}

function handleSwap(pos: { row: number; col: number }, dir: 'up' | 'down' | 'left' | 'right') {
  if (player.currentStep.value.type === 'guided') {
    player.validateSwap(pos, dir);
  }
}

function handleTap(pos: { row: number; col: number }) {
  if (player.currentStep.value.type === 'guided') {
    player.validateTap(pos);
  }
}

// --- Debug: step jump (dev only) ---
const debugOpen = ref(false);
const debugStepOptions = computed(() =>
  allTutorialSteps.map((step, i) => ({
    index: i,
    label: `${i + 1}. [${step.type}] ${step.id}`,
  }))
);
function debugJump(index: number) {
  player.goToStep(index);
  debugOpen.value = false;
}

// Section progress info
const sectionProgress = computed(() => {
  let stepsBefore = 0;
  for (let i = 0; i < player.currentSectionIndex.value; i++) {
    stepsBefore += tutorialSections[i].steps.length;
  }
  const currentSection = tutorialSections[player.currentSectionIndex.value];
  const stepInSection = player.currentStepIndex.value - stepsBefore;
  return {
    sectionTitle: t(currentSection.titleKey),
    current: stepInSection + 1,
    total: currentSection.steps.length,
  };
});

</script>

<template>
  <div class="tutorial-view">
    <!-- Header -->
    <div class="tutorial-header">
      <button class="btn btn-sm back-btn" @click="router.push('/')">&larr;</button>
      <h1 class="header-title">{{ t('tutorial.title') }}</h1>
      <button class="btn btn-sm skip-btn" @click="skip">
        {{ t('common.skip') }}
      </button>
    </div>

    <!-- Board area -->
    <div class="board-area">
      <template v-if="player.activeBoard.value && player.currentStep.value.type !== 'info'">
        <TutorialBoard
          :board="player.activeBoard.value"
          :highlight-cells="(!player.stepCompleted.value && !player.isAnimating.value) ? player.currentStep.value.highlight : undefined"
          :highlight-dir="(!player.stepCompleted.value && !player.isAnimating.value) ? player.currentStep.value.highlightDir : undefined"
          :matched-cells="player.matchedCells"
          :clearing-cells="player.clearingCells"
          :focus-area="player.currentStep.value.focusArea"
          :interactive="player.currentStep.value.type === 'guided' && !player.stepCompleted.value && !player.isAnimating.value"
          @swap="handleSwap"
          @tap="handleTap"
        />
      </template>

      <!-- Info step: show screenshot image, board, or fallback icon -->
      <template v-else-if="player.currentStep.value.type === 'info'">
        <div class="info-visual">
          <img
            v-if="player.currentStep.value.image"
            class="info-screenshot"
            :src="player.currentStep.value.image"
            alt=""
          />
          <TutorialBoard
            v-else-if="player.currentStep.value.board"
            :board="player.currentStep.value.board"
            :matched-cells="player.matchedCells"
            :clearing-cells="player.clearingCells"
            :focus-area="player.currentStep.value.focusArea"
            :interactive="false"
          />
          <div v-else class="info-icon-placeholder">
            <span class="info-icon-text">i</span>
          </div>
        </div>
      </template>
    </div>

    <!-- Debug: step jumper (dev only) -->
    <div v-if="isDev" class="debug-bar">
      <button class="debug-toggle" @click="debugOpen = !debugOpen">
        DBG {{ player.currentStepIndex.value + 1 }}/{{ player.totalSteps }}
      </button>
      <div v-if="debugOpen" class="debug-panel">
        <button
          v-for="opt in debugStepOptions"
          :key="opt.index"
          :class="['debug-step-btn', { active: opt.index === player.currentStepIndex.value }]"
          @click="debugJump(opt.index)"
        >
          {{ opt.label }}
        </button>
      </div>
    </div>

    <!-- Text card -->
    <div class="text-card">
      <!-- Section label -->
      <div class="section-label">
        {{ sectionProgress.sectionTitle }}
        <span class="section-progress">{{ sectionProgress.current }}/{{ sectionProgress.total }}</span>
      </div>

      <h2 class="step-title">{{ t(player.currentStep.value.titleKey) }}</h2>
      <p class="step-body">{{ t(player.currentStep.value.bodyKey) }}</p>

      <!-- Try it prompt -->
      <div v-if="player.showTryItPrompt.value" class="try-it-prompt">
        {{ t('tutorial.tryIt') }}
      </div>

      <!-- Success message -->
      <div v-if="player.showSuccessMessage.value" class="success-message">
        {{ t('tutorial.great') }}
      </div>

      <!-- Navigation -->
      <div class="nav-row">
        <button
          class="btn nav-btn"
          :disabled="player.isFirstStep.value"
          @click="player.prevStep()"
        >
          &larr;
        </button>

        <!-- Dot indicator -->
        <div class="dot-indicator">
          <span
            v-for="i in player.totalSteps"
            :key="i"
            :class="['dot', { active: i - 1 === player.currentStepIndex.value, done: i - 1 < player.currentStepIndex.value }]"
          />
        </div>

        <button
          v-if="player.isLastStep.value && player.stepCompleted.value"
          class="btn btn-primary nav-btn nav-forward"
          @click="finish"
        >
          {{ t('tutorial.done') }}
        </button>
        <button
          v-else
          class="btn btn-primary nav-btn nav-forward"
          :disabled="!player.stepCompleted.value"
          @click="player.nextStep()"
        >
          {{ t('tutorial.next') }} &rarr;
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.tutorial-view {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

/* Header */
.tutorial-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 16px;
  flex-shrink: 0;
}
.back-btn {
  min-width: 40px;
  padding: 0 10px;
  font-size: 20px;
}
.header-title {
  font-size: 20px;
  font-weight: 800;
  color: var(--ink);
  margin: 0;
}
.skip-btn {
  font-size: 14px;
}

/* Board area */
.board-area {
  flex: 1;
  display: flex;
  align-items: stretch;
  justify-content: center;
  padding: 8px 16px;
  min-height: 0;
  overflow: hidden;
}

/* Info visual */
.info-visual {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 16px;
  width: 100%;
  height: 100%;
}
.info-screenshot {
  max-width: 100%;
  max-height: 100%;
  border: var(--frame);
  border-radius: 14px;
  object-fit: contain;
}
.info-icon-placeholder {
  width: 80px;
  height: 80px;
  border-radius: 50%;
  background: var(--bg-card-alt);
  display: flex;
  align-items: center;
  justify-content: center;
}
.info-icon-text {
  font-size: 36px;
  font-weight: 700;
  color: var(--text-muted);
}

/* Text card */
/* A sheet over the bottom, as the menu */
.text-card {
  background: var(--bg-card);
  border: var(--frame);
  border-bottom: 0;
  border-radius: 24px 24px 0 0;
  padding: 16px 20px 20px;
  flex-shrink: 0;
}

.section-label {
  font-size: 10px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  color: var(--brand);
  margin-bottom: 4px;
  display: flex;
  align-items: center;
  gap: 6px;
}
.section-progress {
  color: var(--text-muted);
  font-weight: 500;
}

.step-title {
  font-size: 18px;
  font-weight: 700;
  color: var(--text-primary);
  margin: 0 0 6px;
}
.step-body {
  font-size: 13px;
  color: var(--text-secondary);
  line-height: 1.6;
  margin: 0 0 12px;
}

/* Try it prompt */
.try-it-prompt {
  font-size: 14px;
  font-weight: 700;
  color: var(--brand);
  text-align: center;
  padding: 8px;
  margin-bottom: 8px;
  animation: try-it-bounce 1.5s ease-in-out infinite;
}
@keyframes try-it-bounce {
  0%, 100% { transform: translateY(0); }
  50% { transform: translateY(-3px); }
}

/* Success message */
.success-message {
  font-size: 16px;
  font-weight: 800;
  color: var(--brand);
  text-align: center;
  padding: 6px;
  margin-bottom: 8px;
  animation: success-pop 0.4s ease-out;
}
@keyframes success-pop {
  0% { transform: scale(0); opacity: 0; }
  60% { transform: scale(1.2); opacity: 1; }
  100% { transform: scale(1); opacity: 1; }
}

/* Navigation row */
.nav-row {
  display: flex;
  align-items: center;
  gap: 12px;
}
.nav-btn {
  flex-shrink: 0;
}
.nav-forward {
  margin-left: auto;
}

/* Dot indicator */
.dot-indicator {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
  overflow: hidden;
}
.dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--border);
  flex-shrink: 0;
  transition: background 0.2s, transform 0.2s;
}
.dot.active {
  background: var(--brand);
  transform: scale(1.4);
}
.dot.done {
  background: var(--brand);
  opacity: 0.4;
}

/* Debug bar (dev only) */
.debug-bar {
  position: fixed;
  top: 52px;
  right: max(4px, calc((100vw - 480px) / 2 + 4px));
  z-index: 9999;
}
.debug-toggle {
  padding: 2px 8px;
  border: 1px solid #f44;
  border-radius: 4px;
  background: rgba(255, 68, 68, 0.1);
  color: #f44;
  font-size: 10px;
  font-weight: 700;
  font-family: monospace;
  cursor: pointer;
}
.debug-panel {
  position: absolute;
  top: 100%;
  right: 0;
  margin-top: 4px;
  background: var(--bg-card);
  border: 1px solid #f44;
  border-radius: 6px;
  padding: 4px;
  display: flex;
  flex-direction: column;
  gap: 1px;
  max-height: 60vh;
  overflow-y: auto;
  min-width: 220px;
}
.debug-step-btn {
  padding: 5px 8px;
  border: none;
  border-radius: 3px;
  background: none;
  color: var(--text-secondary);
  font-size: 11px;
  font-family: monospace;
  text-align: left;
  cursor: pointer;
  white-space: nowrap;
}
.debug-step-btn:hover {
  background: var(--bg-hover);
}
.debug-step-btn.active {
  background: rgba(255, 68, 68, 0.15);
  color: #f44;
  font-weight: 700;
}
</style>
