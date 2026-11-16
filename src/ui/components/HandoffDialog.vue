<script setup lang="ts">
import { ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { useGameStore } from '@/stores/game';
import NameDialog from './NameDialog.vue';

/**
 * Brings the records of an old vegtab.app account over to this device's ID. The old URL opens this
 * page with a handoff token in the fragment (docs/SPEC.md §5.4); the records move only after the
 * player agrees, so a link from someone else cannot switch them unnoticed
 */
const props = defineProps<{ token: string }>();
const emit = defineEmits<{ close: [] }>();

const { t } = useI18n();
const gameStore = useGameStore();

type State = 'asking' | 'working' | 'done' | 'refused' | 'failed';
const state = ref<State>('asking');
/** Why the name has to be chosen again, shown in the name dialog after this one */
const nameNotice = ref<string | null>(null);

async function accept() {
  state.value = 'working';
  // The claim needs the ID's cookie, which the first session sets
  await gameStore.init();
  const result = await gameStore.claimHandoff(props.token);
  if (!result.ok) {
    state.value = result.reason === 'invalid' ? 'refused' : 'failed';
    return;
  }
  state.value = 'done';
  if (result.name === 'taken') nameNotice.value = t('handoff.nameTaken');
  else if (result.name === 'invalid') nameNotice.value = t('handoff.nameInvalid');
}

const showNameDialog = ref(false);

function close() {
  if (state.value === 'working') return;
  if (nameNotice.value) {
    showNameDialog.value = true;
    return;
  }
  emit('close');
}
</script>

<template>
  <Teleport to="body">
    <div v-if="!showNameDialog" class="modal-overlay">
      <div class="modal" role="alertdialog" aria-modal="true">
        <h3 class="modal-title">{{ state === 'done' ? t('handoff.done') : t('handoff.title') }}</h3>
        <template v-if="state === 'done' || state === 'refused'">
          <p v-if="state === 'refused'" class="modal-desc" role="alert">{{ t('handoff.invalid') }}</p>
          <div class="modal-actions">
            <button class="modal-btn-primary" @click="close">{{ t('common.ok') }}</button>
          </div>
        </template>
        <template v-else>
          <p class="modal-desc">{{ t('handoff.message') }}</p>
          <p v-if="state === 'working'" class="modal-desc" role="status">{{ t('handoff.working') }}</p>
          <p v-if="state === 'failed'" class="modal-warning" role="alert">{{ t('handoff.failed') }}</p>
          <div class="modal-actions">
            <button class="modal-btn-primary" :disabled="state === 'working'" @click="accept">{{ t('handoff.accept') }}</button>
            <button class="modal-btn-secondary" :disabled="state === 'working'" @click="close">{{ t('common.cancel') }}</button>
          </div>
        </template>
      </div>
    </div>
  </Teleport>
  <NameDialog :open="showNameDialog" :notice="nameNotice ?? undefined" @close="emit('close')" />
</template>
