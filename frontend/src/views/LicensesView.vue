<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRouter } from 'vue-router';
import type { LicenseEntry } from '../../licenses.plugin';

/**
 * The open source packages Vege-Table ships, with their licences. licenses.json is written by the
 * build (licenses.plugin.ts), so the dev server has none
 */
const { t, locale } = useI18n();
const router = useRouter();

function usedInText(e: LicenseEntry): string {
  return new Intl.ListFormat(locale.value, { type: 'conjunction' }).format(e.usedIn.map(u => t(`licenses.usedIn.${u}`)));
}
const entries = ref<LicenseEntry[] | null>(null);
const failed = ref(false);

onMounted(async () => {
  try {
    const res = await fetch('/licenses.json');
    if (!res.ok) throw new Error(String(res.status));
    entries.value = await res.json() as LicenseEntry[];
  } catch {
    failed.value = true;
  }
});
</script>

<template>
  <div class="licenses-page">
    <header class="licenses-header">
      <button class="btn btn-sm back-btn" :aria-label="t('licenses.back')" @click="router.push('/about')">&larr;</button>
      <h1 class="licenses-title">{{ t('licenses.title') }}</h1>
    </header>
    <p class="licenses-desc">{{ t('licenses.desc') }}</p>

    <p v-if="failed" class="licenses-desc">{{ t('licenses.unavailable') }}</p>
    <ul v-else-if="entries" class="licenses-list">
      <li v-for="e in entries" :key="`${e.name}@${e.version}`" class="card license-item">
        <div class="license-head">
          <a v-if="e.url" :href="e.url" target="_blank" rel="noopener noreferrer" class="license-name">{{ e.name }}</a>
          <span v-else class="license-name">{{ e.name }}</span>
          <span class="license-version">{{ e.version }}</span>
        </div>
        <p class="license-meta">{{ t('licenses.meta', { license: e.license, usedIn: usedInText(e) }) }}</p>
        <details v-if="e.text">
          <summary>{{ t('licenses.showText') }}</summary>
          <pre class="license-text">{{ e.text }}</pre>
        </details>
        <!-- Some packages don't ship their licence file; their repository has it -->
        <p v-else-if="e.url" class="license-meta">{{ t('licenses.textAtSource') }}</p>
      </li>
    </ul>
  </div>
</template>

<style scoped>
/* Fills the room above the footer menu (App.vue) and scrolls inside, as the other screens */
.licenses-page {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 12px 16px 24px;
}
.licenses-header {
  display: flex;
  align-items: center;
  gap: 12px;
}
.back-btn {
  min-width: 40px;
  padding: 0 10px;
  font-size: 20px;
}
.licenses-title {
  margin: 0;
  font-size: 20px;
  font-weight: 800;
}
.licenses-desc {
  margin: 12px 0;
  font-size: 14px;
  color: var(--text-secondary);
}
.licenses-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  gap: 10px;
}
.license-item {
  padding: 12px 14px;
}
.license-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 8px;
}
.license-name {
  font-weight: 800;
  color: var(--brand);
  overflow-wrap: anywhere;
}
.license-version,
.license-meta {
  font-size: 12px;
  color: var(--text-muted);
}
.license-meta {
  margin: 2px 0 6px;
}
details summary {
  font-size: 13px;
  font-weight: 700;
  color: var(--text-secondary);
  cursor: pointer;
}
.license-text {
  margin: 8px 0 0;
  max-height: 240px;
  overflow: auto;
  padding: 8px;
  border-radius: 8px;
  background: var(--bg-card-alt);
  font-size: 11px;
  line-height: 1.5;
  white-space: pre-wrap;
}
</style>
