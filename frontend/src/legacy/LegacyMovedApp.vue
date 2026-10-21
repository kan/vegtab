<script setup lang="ts">
import { ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { requestHandoffUrl, hasLegacyAccount, NEW_ORIGIN } from './handoff';

/**
 * The whole screen of the old URL (vegtab.app) after the move (docs/SPEC.md §5.4): the moving notice,
 * and the way to bring this device's records to the new URL
 */
const { t } = useI18n();

type State = 'idle' | 'working' | 'claimed' | 'failed';
const state = ref<State>('idle');
const hasAccount = hasLegacyAccount();

async function carry() {
  state.value = 'working';
  const result = await requestHandoffUrl();
  if (result.ok) {
    window.location.href = result.url;
    return;
  }
  state.value = result.reason === 'claimed' ? 'claimed' : 'failed';
}
</script>

<template>
  <div class="moved">
    <div class="modal">
      <h1 class="modal-title">{{ t('moved.title') }}</h1>
      <p class="modal-desc">{{ t('moved.message') }}</p>
      <p v-if="state === 'claimed'" class="modal-warning" role="status">{{ t('moved.claimed') }}</p>
      <p v-if="state === 'failed'" class="modal-warning" role="alert">{{ t('moved.failed') }}</p>
      <div class="modal-actions">
        <button
          v-if="hasAccount && state !== 'claimed'"
          class="modal-btn-primary"
          :disabled="state === 'working'"
          @click="carry"
        >
          {{ state === 'working' ? t('moved.working') : t('moved.carry') }}
        </button>
        <a class="modal-btn-secondary moved-link" :href="NEW_ORIGIN">{{ t('moved.go') }}</a>
      </div>
      <p class="moved-note">{{ t('moved.note') }}</p>
    </div>
  </div>
</template>

<style scoped>
.moved {
  min-height: 100dvh;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--bg-page);
}
.moved-link {
  text-align: center;
  text-decoration: none;
}
.moved-note {
  font-size: 11px;
  color: var(--text-muted);
  margin: 12px 0 0;
}
</style>
