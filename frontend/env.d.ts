/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** kan/game's local portal for a local build (src/api/id.ts portalUrl). Default http://localhost:8787 */
  readonly VITE_KAN_GAME_PORTAL?: string;
}

declare module '*.vue' {
  import type { DefineComponent } from 'vue';
  const component: DefineComponent<object, object, unknown>;
  export default component;
}
