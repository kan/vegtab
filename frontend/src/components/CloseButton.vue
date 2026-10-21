<script setup lang="ts">
import { useI18n } from 'vue-i18n';

/** The round × that closes a dialog or the menu (in a .modal-header) */
const { t } = useI18n();
</script>

<template>
  <button class="icon-btn" :aria-label="t('common.close')">
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18" /></svg>
  </button>
</template>
