import { computed, ref } from 'vue';

/**
 * 「ホーム画面に追加」 in the menu (#121, from TAKO-SEN's src/ui/install.ts, kan/tako-sen#20).
 * Where the browser offers the install prompt (`beforeinstallprompt`, Chrome on Android), the
 * button shows it; on iPhone and iPad, which have no such API, it shows the steps in the share
 * menu instead (components/InstallSteps.vue)
 */
interface InstallPromptEvent extends Event {
  prompt(): Promise<void>;
  readonly userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

export function isAppleTouchDevice(): boolean {
  return /iPad|iPhone|iPod/.test(navigator.userAgent)
    // iPadOS reports itself as a Mac
    || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

/**
 * Safari itself: the steps go through its share menu. Other browsers and the in-app browsers of
 * LINE and the like have the share menu elsewhere or not at all (their user agents carry their own
 * names, or no "Safari/")
 */
function isSafari(): boolean {
  const agent = navigator.userAgent;
  return /Safari\//.test(agent)
    // GSA: the Google app; YJApp: the Yahoo! JAPAN app
    && !/CriOS|FxiOS|EdgiOS|OPiOS|GSA\/|YJApp|Line\/|Instagram|FBAN|FBAV/.test(agent);
}

/** Opened from the home screen (or as an installed app) */
export function isStandalone(): boolean {
  return window.matchMedia?.('(display-mode: standalone)').matches
    || (navigator as { standalone?: boolean }).standalone === true;
}

/** The browser's prompt, kept until it is shown: each one shows only once */
const deferredPrompt = ref<InstallPromptEvent>();
const standalone = ref(false);
const appleSafari = ref(false);

/**
 * How the menu offers the install: the browser's prompt, the steps for iPhone and iPad, or nothing
 * (already on the home screen, or a browser that offers no way to add it)
 */
export const installOffer = computed<'prompt' | 'steps' | undefined>(() => {
  if (standalone.value) return undefined;
  if (deferredPrompt.value) return 'prompt';
  return appleSafari.value ? 'steps' : undefined;
});

/** Before mounting: the prompt may come before the screens are up */
export function startInstallOffer(): void {
  standalone.value = isStandalone();
  appleSafari.value = isAppleTouchDevice() && isSafari();
  // Chrome may move this page into the installed app's window
  window.matchMedia?.('(display-mode: standalone)')
    .addEventListener?.('change', () => { standalone.value = isStandalone(); });
  window.addEventListener('beforeinstallprompt', (event) => {
    // Kept for the button instead of the browser's own banner
    event.preventDefault();
    deferredPrompt.value = event as InstallPromptEvent;
  });
  window.addEventListener('appinstalled', () => {
    deferredPrompt.value = undefined;
  });
}

/** Shows the browser's prompt. A refused one is offered again when the browser sends another */
export async function promptInstall(): Promise<void> {
  const event = deferredPrompt.value;
  if (!event) return;
  deferredPrompt.value = undefined;
  try {
    await event.prompt();
    await event.userChoice;
  } catch {
    // Already shown (another tab) or refused by the browser
  }
}
