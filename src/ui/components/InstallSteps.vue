<script setup lang="ts">
import { useI18n } from 'vue-i18n';

/**
 * The steps to add Vege-Table to the home screen on iPhone and iPad, which have no API to install
 * from a button (src/ui/lib/install.ts). The wording follows TAKO-SEN's InstallSteps.vue
 */
const { t } = useI18n();
</script>

<template>
  <div class="install-steps">
    <p class="modal-desc">{{ t('install.intro') }}</p>
    <ol>
      <li>{{ t('install.step1') }}</li>
      <li>{{ t('install.step2') }}</li>
      <li>{{ t('install.step3') }}</li>
    </ol>
    <p class="modal-desc">{{ t('install.outro') }}</p>
  </div>
</template>

<style scoped>
.install-steps ol {
  margin: 0 0 12px;
  padding-left: 1.4em;
  display: grid;
  gap: 8px;
  line-height: 1.6;
}
</style>
