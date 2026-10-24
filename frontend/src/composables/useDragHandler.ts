import { ref, reactive } from 'vue';
import { BOARD_SIZE, isValidPosition, type Position, type Direction } from '@vegtab/engine';
import { useAnim } from '@/anim';
import { adj } from '@/lib/boardInput';

function dragDir(dx: number, dy: number): Direction | null {
  if (Math.abs(dx) < 2 && Math.abs(dy) < 2) return null;
  return Math.abs(dx) >= Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : (dy > 0 ? 'down' : 'up');
}

function pk(row: number, col: number) { return `${row},${col}`; }

export function useDragHandler(
  cellSize: { value: number },
  boardEl: { value: HTMLElement | null },
  onSwap: (pos: Position, dir: Direction) => void,
  onTap: (pos: Position) => void,
  options?: {
    isDragSuppressed?: () => boolean;
    /** 動かせないマス（鎖の付いた野菜、#107）。そこから、またはそこへのドラッグはタイルを少しだけ揺らして止める */
    isImmovable?: (pos: Position) => boolean;
  },
) {
  const { ANIM } = useAnim();
  const cellOffsets = reactive<Record<string, { x: number; y: number; transition: boolean; z: number }>>({});
  let ptrX = 0, ptrY = 0;
  let ptrPos: Position | null = null;
  let handled = false;
  let dragAxis: 'x' | 'y' | null = null;
  let locked = false;

  function setLocked(v: boolean) { locked = v; }

  function getCellAt(x: number, y: number): Position | null {
    if (!boardEl.value || !cellSize.value) return null;
    const r = boardEl.value.getBoundingClientRect();
    const col = Math.floor((x - r.left) / cellSize.value);
    const row = Math.floor((y - r.top) / cellSize.value);
    if (row < 0 || row >= BOARD_SIZE || col < 0 || col >= BOARD_SIZE) return null;
    return { row, col };
  }

  function getOff(r: number, c: number) {
    return cellOffsets[pk(r, c)] ?? { x: 0, y: 0, transition: false, z: 0 };
  }

  function setOff(r: number, c: number, x: number, y: number, tr: boolean, z = 0) {
    cellOffsets[pk(r, c)] = { x, y, transition: tr, z };
  }

  function clearOff(r: number, c: number) { delete cellOffsets[pk(r, c)]; }

  function snapBack(pos: Position) {
    setOff(pos.row, pos.col, 0, 0, true, 0);
    for (const d of ['up', 'down', 'left', 'right'] as Direction[]) {
      const n = adj(pos, d);
      if (n.row >= 0 && n.row < BOARD_SIZE && n.col >= 0 && n.col < BOARD_SIZE) {
        setOff(n.row, n.col, 0, 0, true, 0);
      }
    }
    setTimeout(() => {
      clearOff(pos.row, pos.col);
      for (const d of ['up', 'down', 'left', 'right'] as Direction[]) {
        const n = adj(pos, d);
        clearOff(n.row, n.col);
      }
    }, ANIM.value.SWAP);
  }

  function onPointerDown(e: PointerEvent) {
    if (locked) return;
    const pos = getCellAt(e.clientX, e.clientY);
    if (!pos) return;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    ptrX = e.clientX; ptrY = e.clientY;
    ptrPos = pos; handled = false; dragAxis = null;
    setOff(pos.row, pos.col, 0, 0, false, 10);
  }

  function onPointerMove(e: PointerEvent) {
    if (!ptrPos || handled || locked) return;
    if (options?.isDragSuppressed?.()) return;
    const dx = e.clientX - ptrX, dy = e.clientY - ptrY;
    const cs = cellSize.value;
    if (!dragAxis) {
      if (Math.abs(dx) > 5 || Math.abs(dy) > 5) dragAxis = Math.abs(dx) >= Math.abs(dy) ? 'x' : 'y';
      else return;
    }
    let cx = 0, cy = 0;
    if (dragAxis === 'x') cx = Math.max(-cs, Math.min(cs, dx));
    else cy = Math.max(-cs, Math.min(cs, dy));
    const dir = dragDir(cx, cy);
    const nb = dir ? adj(ptrPos, dir) : null;
    const target = nb && isValidPosition(nb) ? nb : null;
    const selfStuck = options?.isImmovable?.(ptrPos) ?? false;
    if (selfStuck || (target && options?.isImmovable?.(target))) {
      // 動かせない: 指の方向へ少しだけ引っかかって止まる（鎖の野菜自身はさらに小さく）。
      // 入れ替えは起こさず、指を離すと戻る
      const tug = cs * (selfStuck ? 0.04 : 0.08);
      const clamp = (v: number) => Math.max(-tug, Math.min(tug, v));
      setOff(ptrPos.row, ptrPos.col, clamp(cx), clamp(cy), false, 10);
      // 同じドラッグで先に反対側の隣を動かしていたら、元の位置へ戻す
      for (const d of ['up', 'down', 'left', 'right'] as Direction[]) {
        const n = adj(ptrPos, d);
        if (isValidPosition(n)) clearOff(n.row, n.col);
      }
      return;
    }
    setOff(ptrPos.row, ptrPos.col, cx, cy, false, 10);
    if (target) setOff(target.row, target.col, -cx, -cy, false, 0);
    if (Math.abs(cx) > cs * 0.4 || Math.abs(cy) > cs * 0.4) {
      handled = true;
      onSwap(ptrPos, dir!);
      ptrPos = null;
    }
  }

  function onPointerUp(e: PointerEvent, interceptTap?: (pos: Position) => boolean) {
    if (locked) return;
    if (ptrPos && !handled) {
      if (Math.abs(e.clientX - ptrX) < 5 && Math.abs(e.clientY - ptrY) < 5) {
        if (interceptTap && interceptTap(ptrPos)) {
          clearOff(ptrPos.row, ptrPos.col);
          ptrPos = null; handled = false; dragAxis = null;
          return;
        }
        onTap(ptrPos);
      }
      snapBack(ptrPos);
    }
    ptrPos = null; handled = false; dragAxis = null;
  }

  return {
    cellOffsets,
    getOff,
    setOff,
    clearOff,
    setLocked,
    onPointerDown,
    onPointerMove,
    onPointerUp,
    getCellAt,
  };
}

export { pk, dragDir };
