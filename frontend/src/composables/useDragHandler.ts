import { ref, reactive } from 'vue';
import { BOARD_SIZE, type Position, type Direction } from '@tomado/engine';
import { useAnim } from '@/anim';

function adj(p: Position, d: Direction): Position {
  switch (d) {
    case 'up': return { row: p.row - 1, col: p.col };
    case 'down': return { row: p.row + 1, col: p.col };
    case 'left': return { row: p.row, col: p.col - 1 };
    case 'right': return { row: p.row, col: p.col + 1 };
  }
}

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
  options?: { isDragSuppressed?: () => boolean },
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
    setOff(ptrPos.row, ptrPos.col, cx, cy, false, 10);
    const dir = dragDir(cx, cy);
    if (dir) {
      const nb = adj(ptrPos, dir);
      if (nb.row >= 0 && nb.row < BOARD_SIZE && nb.col >= 0 && nb.col < BOARD_SIZE) {
        setOff(nb.row, nb.col, -cx, -cy, false, 0);
      }
    }
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

export { pk, adj, dragDir };
