/**
 * その日のパズル（seed）ごとの累計プレイ時間。リトライをまたいで足し続ける。
 * 数えるのはパズル画面を開いていて、アニメーション中でないときだけ（数える条件は usePlayTimer が決める）
 */
import { getItemSync, setLocalItem } from '@/lib/storage';

const STORAGE_KEY = 'vegtab_play_time';
/** 保存しておく seed の数。カレンダーから遊べる過去 60 日分より多めにとる */
const MAX_ENTRIES = 90;

/**
 * `s<seed>` → 累計ミリ秒。挿入順が古い順になるよう、更新した seed は末尾に移す
 * （数字だけのキーはオブジェクトが数値順に並べ替えるので、接頭辞を付けて挿入順を保つ）
 */
type PlayTimeMap = Record<string, number>;

const keyOf = (seed: number) => `s${seed}`;

function isPlayTimeMap(v: unknown): v is PlayTimeMap {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
    && Object.values(v).every(x => typeof x === 'number' && Number.isFinite(x) && x >= 0);
}

export function loadPlayTimes(): PlayTimeMap {
  try {
    const raw = getItemSync(STORAGE_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : {};
    return isPlayTimeMap(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

/** times に seed の値を設定し、古い seed を MAX_ENTRIES まで間引いた新しいマップを返す */
export function withPlayTime(times: PlayTimeMap, seed: number, ms: number): PlayTimeMap {
  const { [keyOf(seed)]: _old, ...rest } = times;
  const next: PlayTimeMap = { ...rest, [keyOf(seed)]: Math.max(0, Math.round(ms)) };
  const keys = Object.keys(next);
  for (const k of keys.slice(0, Math.max(0, keys.length - MAX_ENTRIES))) delete next[k];
  return next;
}

export function getPlayTime(seed: number): number {
  return loadPlayTimes()[keyOf(seed)] ?? 0;
}

export function savePlayTime(seed: number, ms: number) {
  setLocalItem(STORAGE_KEY, JSON.stringify(withPlayTime(loadPlayTimes(), seed, ms)));
}

/** 記録の時間の表示。時間の記録がない（時間を順位に入れる前の）記録は '-:--' */
export function formatRecordTime(ms: number | null | undefined): string {
  return ms == null ? '-:--' : formatPlayTime(ms);
}

/** ミリ秒を m:ss（1 時間以上は h:mm:ss）にする。秒未満は切り捨て */
export function formatPlayTime(ms: number): string {
  const total = Math.floor(Math.max(0, ms) / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const ss = String(s).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}
