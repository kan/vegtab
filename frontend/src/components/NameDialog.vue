<script setup lang="ts">
import { ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { useGameStore, type NameResult } from '@/stores/game';
import { kanGameName } from '@/api/id';

/**
 * Joins the rankings: registers the kan-game.app name (shared by the kan-game.app games, cannot
 * change) and consents to publish it here. An ID named in another game only consents
 */
const props = defineProps<{
  open: boolean;
  /** Why the dialog opened, shown above the form (e.g. the old name could not be carried over) */
  notice?: string;
}>();
const emit = defineEmits<{ close: [] }>();

const { t } = useI18n();
const gameStore = useGameStore();

const nameInput = ref('');
const saving = ref(false);
const error = ref<Exclude<NameResult, 'ok'> | null>(null);

watch(() => props.open, (open) => {
  if (!open) return;
  nameInput.value = '';
  error.value = null;
});

async function join() {
  const name = kanGameName.value ?? nameInput.value.trim();
  if (!name || saving.value) return;
  saving.value = true;
  const result = await gameStore.setDisplayName(name);
  saving.value = false;
  if (result === 'ok') emit('close');
  else error.value = result;
}
</script>

<template>
  <Teleport to="body">
    <div v-if="open" class="modal-overlay">
      <div class="modal">
        <h3 class="modal-title">{{ t('name.title') }}</h3>
        <p v-if="notice" class="modal-warning">{{ notice }}</p>
        <template v-if="kanGameName">
          <p class="modal-desc">{{ t('name.fromOtherGame') }}</p>
          <p class="name-fixed">{{ kanGameName }}</p>
        </template>
        <template v-else>
          <p class="modal-desc">{{ t('name.message') }}</p>
          <input
            v-model="nameInput"
            class="modal-input"
            maxlength="40"
            :placeholder="t('home.namePlaceholder')"
            @keyup.enter="join"
          />
        </template>
        <p class="name-note">{{ t('name.note') }}</p>
        <p v-if="error" class="name-error" role="alert">{{ t(`name.error.${error}`) }}</p>
        <div class="modal-actions">
          <button class="modal-btn-primary" :disabled="(!kanGameName && !nameInput.trim()) || saving" @click="join">
            {{ t('name.join') }}
          </button>
          <button class="modal-btn-secondary" @click="emit('close')">{{ t('puzzle.namePromptLater') }}</button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.name-fixed {
  font-size: 18px;
  font-weight: 700;
  text-align: center;
  color: var(--text-primary);
  margin: 0 0 12px;
}
.name-note {
  font-size: 11px;
  color: var(--text-muted);
  margin: 0 0 12px;
}
.name-error {
  font-size: 12px;
  color: var(--danger);
  margin: 0 0 12px;
}
</style>
