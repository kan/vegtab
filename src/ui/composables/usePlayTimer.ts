import { ref, watch, onMounted, onUnmounted, type Ref } from 'vue';
import { getPlayTime, savePlayTime } from '@/lib/playTime';
import { PlayClock } from '@/lib/playClock';

/** 表示を確かめる間隔。表示は秒単位なので、値が変わるのは 1 秒に 1 回 */
const TICK_MS = 250;
/** 動いている間に localStorage へ書き出す間隔 */
const SAVE_EVERY_MS = 5000;

/**
 * seed ごとの累計プレイ時間を数える。リトライをまたいで足し続け、localStorage に保存する。
 * playing が true で、animating が false で、かつタブが見えている間だけ数える（パズル画面を離れれば unmount で止まる）
 */
export function usePlayTimer(seed: Ref<number>, playing: Ref<boolean>, animating: Ref<boolean>) {
  /** 表示用の累計（秒に切り捨て） */
  const elapsedMs = ref(0);
  const visible = ref(document.visibilityState !== 'hidden');

  let clock: PlayClock | null = null;
  let timer: ReturnType<typeof setInterval> | undefined;
  /**
   * タブを離れていた後は、別のタブが同じ seed の時間を足しているかもしれないので、再開時に保存値と突き合わせる。
   * アニメーションのたびに読むと 1 手ごとに localStorage を parse するので、離れた後だけにする
   */
  let syncOnStart = true;

  function show() {
    elapsedMs.value = clock ? Math.floor(clock.now() / 1000) * 1000 : 0;
  }

  function update() {
    if (!clock) return;
    if (playing.value && visible.value && !animating.value) {
      clock.start(syncOnStart ? getPlayTime(seed.value) : 0);
      syncOnStart = false;
    } else {
      if (!visible.value) syncOnStart = true;
      // タブを離れたとき（閉じられるかもしれない）とゲーム終了のときは保存する。アニメーション中の停止はメモリだけ
      clock.stop(!visible.value || !playing.value);
    }
    show();
  }

  function tick() {
    if (!clock?.running) return;
    clock.tick();
    show();
  }

  function onVisibilityChange() {
    visible.value = document.visibilityState !== 'hidden';
  }

  function onPageHide() {
    clock?.stop(true);
    syncOnStart = true;
  }

  watch(seed, (s) => {
    clock?.stop(true);
    clock = s ? new PlayClock(getPlayTime(s), () => performance.now(), ms => savePlayTime(s, ms), SAVE_EVERY_MS) : null;
    syncOnStart = false;
    update();
  }, { immediate: true });

  watch([playing, animating, visible], update);

  onMounted(() => {
    document.addEventListener('visibilitychange', onVisibilityChange);
    window.addEventListener('pagehide', onPageHide);
    // bfcache から戻ったとき、visibilitychange が来ない環境でも計測を再開する
    window.addEventListener('pageshow', update);
    timer = setInterval(tick, TICK_MS);
  });

  onUnmounted(() => {
    // アニメーション中に画面を離れた場合も、確定済みの累計を残す
    clock?.stop(true);
    document.removeEventListener('visibilitychange', onVisibilityChange);
    window.removeEventListener('pagehide', onPageHide);
    window.removeEventListener('pageshow', update);
    clearInterval(timer);
  });

  return {
    elapsedMs,
    /** 呼んだ時点の正確な累計（クリアした瞬間の記録に使う） */
    now: () => clock?.now() ?? 0,
  };
}
