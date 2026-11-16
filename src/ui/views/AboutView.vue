<script setup lang="ts">
import { useI18n } from 'vue-i18n';
import { portalUrl } from '@/api/id';

const { t } = useI18n();
</script>

<template>
  <div class="about-page">
    <div class="about-content">
      <h1 class="about-title">Vege-Table</h1>

      <section class="about-section">
        <!-- The portal's own icon, loaded from the portal so it follows any change there -->
        <h2>
          <a class="portal-link" :href="portalUrl('/')" target="_blank" rel="noopener">
            <img class="portal-icon" :src="portalUrl('/favicon.svg')" alt="" width="28" height="28" />
            kan-game.app
          </a>
        </h2>
        <p class="about-text">{{ t('about.kanGame') }}</p>
        <div class="credit-item">
          <a :href="portalUrl('/terms')" target="_blank" rel="noopener">{{ t('about.terms') }}</a>
          <a :href="portalUrl('/privacy')" target="_blank" rel="noopener">{{ t('about.privacy') }}</a>
        </div>
      </section>

      <section class="about-section">
        <h2>{{ t('about.credits') }}</h2>
        <router-link to="/licenses" class="row-btn licenses-link">{{ t('about.licenses') }}</router-link>
      </section>
    </div>
  </div>
</template>

<style scoped>
/* Fills the room above the footer menu (App.vue) and scrolls inside, as the other screens */
.about-page {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow-y: auto;
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
.portal-link {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  color: var(--ink);
  text-decoration: underline;
  text-underline-offset: 3px;
}
.licenses-link {
  text-decoration: none;
}
.portal-icon {
  width: 28px;
  height: 28px;
  border-radius: 7px;
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
</style>
