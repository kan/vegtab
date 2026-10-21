<script setup lang="ts">
import { useI18n } from 'vue-i18n';
import BottomNav from '@/components/BottomNav.vue';
import { portalUrl } from '@/api/id';

const { t } = useI18n();
</script>

<template>
  <div class="about-page">
    <div class="about-content">
      <h1 class="about-title">Vege-Table</h1>

      <section class="about-section">
        <h2>kan-game.app</h2>
        <p class="about-text">{{ t('about.kanGame') }}</p>
        <div class="credit-item">
          <a :href="portalUrl('/terms')" target="_blank" rel="noopener">{{ t('about.terms') }}</a>
          <a :href="portalUrl('/privacy')" target="_blank" rel="noopener">{{ t('about.privacy') }}</a>
        </div>
      </section>

      <section class="about-section">
        <h2>{{ t('about.credits') }}</h2>
        <div class="credit-item">
          <span class="credit-label">{{ t('about.icons') }}</span>
          <a href="https://openmoji.org/" target="_blank" rel="noopener noreferrer">OpenMoji</a>
          <span class="credit-license">CC BY-SA 4.0</span>
        </div>
      </section>
    </div>
    <BottomNav />
  </div>
</template>

<style scoped>
.about-page {
  display: flex;
  flex-direction: column;
  min-height: 100dvh;
}
.about-content {
  flex: 1;
  max-width: 480px;
  margin: 0 auto;
  padding: 24px 16px;
  width: 100%;
}
.about-title {
  font-size: 24px;
  font-weight: 800;
  color: var(--title-color);
  margin: 0 0 24px;
}
.about-section {
  margin-bottom: 24px;
}
.about-section h2 {
  font-size: 16px;
  font-weight: 800;
  color: var(--ink);
  margin: 0 0 12px;
}
.about-text {
  font-size: 14px;
  color: var(--text-secondary);
  margin: 0 0 12px;
}
.credit-item {
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 48px;
  padding: 8px 14px;
  background: var(--bg-card);
  border: var(--frame-thin);
  border-radius: 14px;
  font-size: 15px;
  color: var(--ink);
}
.credit-item a {
  color: var(--brand);
  text-decoration: none;
  font-weight: 600;
}
.credit-item a:hover {
  text-decoration: underline;
}
.credit-license {
  font-size: 11px;
  color: var(--text-muted);
  background: var(--bg-card);
  padding: 2px 6px;
  border-radius: 4px;
  margin-left: auto;
}
</style>
