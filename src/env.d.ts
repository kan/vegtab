/// <reference types="vite/client" />

/** package.json's version and the commit of the build, as `0.0.1+a44dd3f` (vite.config.ts appVersion) */
declare const __APP_VERSION__: string;

interface ImportMetaEnv {
  /** kan/game's local portal for a local build (src/api/id.ts portalUrl). Default http://localhost:8787 */
  readonly VITE_KAN_GAME_PORTAL?: string;
}

declare module '*.vue' {
  import type { DefineComponent } from 'vue';
  const component: DefineComponent<object, object, unknown>;
  export default component;
}
