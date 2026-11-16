import { afterEach, describe, expect, it, vi } from "vitest";

/** A browser window with only what src/ui/lib/install.ts reads (from TAKO-SEN's tests/install.test.ts) */
function stubBrowser({
  userAgent = "Mozilla/5.0 (Linux; Android 15) Chrome/140",
  standalone = false,
}: { userAgent?: string; standalone?: boolean } = {}) {
  const target = new EventTarget();
  // One media query list, as the page sees the standalone display mode.
  const displayMode = Object.assign(new EventTarget(), {
    matches: standalone,
  });
  vi.stubGlobal("window", {
    addEventListener: target.addEventListener.bind(target),
    matchMedia: (query: string) =>
      query === "(display-mode: standalone)" ? displayMode : { matches: false },
  });
  vi.stubGlobal("navigator", {
    userAgent,
    platform: "Linux armv8l",
    maxTouchPoints: 5,
  });
  return Object.assign(target, {
    /** The page moves into the installed app's window. */
    openAsApp() {
      displayMode.matches = true;
      displayMode.dispatchEvent(new Event("change"));
    },
  });
}

const IPHONE_SAFARI =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Mobile/15E148 Safari/604.1";

function installPrompt(outcome: "accepted" | "dismissed" = "accepted") {
  const event = new Event("beforeinstallprompt", { cancelable: true });
  const prompt = vi.fn(async () => {});
  Object.assign(event, { prompt, userChoice: Promise.resolve({ outcome }) });
  return { event, prompt };
}

async function loadInstall() {
  vi.resetModules();
  const install = await import("@/lib/install");
  install.startInstallOffer();
  return install;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("the home screen button in the menu", () => {
  it("is hidden until the browser sends its prompt", async () => {
    const target = stubBrowser();
    const { installOffer } = await loadInstall();
    expect(installOffer.value).toBeUndefined();
    const { event } = installPrompt();
    target.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    expect(installOffer.value).toBe("prompt");
  });

  it("shows the browser's prompt once, then waits for another", async () => {
    const target = stubBrowser();
    const { installOffer, promptInstall } = await loadInstall();
    const first = installPrompt("dismissed");
    target.dispatchEvent(first.event);
    await promptInstall();
    expect(first.prompt).toHaveBeenCalledOnce();
    expect(installOffer.value).toBeUndefined();
    await promptInstall();
    expect(first.prompt).toHaveBeenCalledOnce();
    target.dispatchEvent(installPrompt().event);
    expect(installOffer.value).toBe("prompt");
  });

  it("goes once the app is installed", async () => {
    const target = stubBrowser();
    const { installOffer } = await loadInstall();
    target.dispatchEvent(installPrompt().event);
    target.dispatchEvent(new Event("appinstalled"));
    expect(installOffer.value).toBeUndefined();
  });

  it("offers the steps in Safari on iPhone and iPad", async () => {
    stubBrowser({ userAgent: IPHONE_SAFARI });
    const { installOffer } = await loadInstall();
    expect(installOffer.value).toBe("steps");
  });

  it("offers no steps in other browsers or in-app browsers on iPhone", async () => {
    for (const userAgent of [
      IPHONE_SAFARI.replace("Version/26.0", "CriOS/140.0"),
      IPHONE_SAFARI.replace("Version/26.0", "GSA/400.0"),
      `${IPHONE_SAFARI} YJApp-IOS jp.co.yahoo.ipn.appli/4.0`,
      `${IPHONE_SAFARI} Line/15.0.0`,
      "Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148",
    ]) {
      stubBrowser({ userAgent });
      const { installOffer } = await loadInstall();
      expect(installOffer.value, userAgent).toBeUndefined();
    }
  });

  it("is hidden when opened from the home screen", async () => {
    const target = stubBrowser({ userAgent: IPHONE_SAFARI, standalone: true });
    const { installOffer } = await loadInstall();
    target.dispatchEvent(installPrompt().event);
    expect(installOffer.value).toBeUndefined();
  });

  it("goes when the page moves into the installed app's window", async () => {
    const target = stubBrowser();
    const { installOffer } = await loadInstall();
    target.dispatchEvent(installPrompt().event);
    target.openAsApp();
    expect(installOffer.value).toBeUndefined();
  });
});
