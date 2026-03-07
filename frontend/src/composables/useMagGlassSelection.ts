import { ref } from 'vue';
import type { Position } from '@tomado/engine';

export interface MagSynthesisInfo {
  pos1: Position;
  pos2: Position;
}

export function useMagGlassSelection() {
  const magSelecting = ref(false);
  const magSourcePos = ref<Position | null>(null);
  const magTargetsNeeded = ref(0);
  const magSelectedCells = ref<Position[]>([]);
  const magSynthesisInfo = ref<MagSynthesisInfo | null>(null);

  /** Enter magnifying glass selection mode (user tapped a mag glass). */
  function startSelection(pos: Position, targets = 1, synthesis: MagSynthesisInfo | null = null) {
    magSelecting.value = true;
    magSourcePos.value = pos;
    magTargetsNeeded.value = targets;
    magSelectedCells.value = [];
    magSynthesisInfo.value = synthesis;
  }

  /**
   * Handle a cell tap during mag selection.
   * Returns the selected cells + synthesis info when selection is complete, or null if still selecting.
   */
  function selectCell(pos: Position): { cells: Position[]; source: Position; synthesis: MagSynthesisInfo | null } | null {
    if (!magSelecting.value) return null;
    // Don't allow selecting the magnifying glass itself
    if (magSourcePos.value && pos.row === magSourcePos.value.row && pos.col === magSourcePos.value.col) return null;
    // Don't allow duplicate selections
    if (magSelectedCells.value.some(p => p.row === pos.row && p.col === pos.col)) return null;

    magSelectedCells.value.push(pos);

    if (magSelectedCells.value.length >= magTargetsNeeded.value) {
      const result = {
        cells: [...magSelectedCells.value],
        source: magSourcePos.value!,
        synthesis: magSynthesisInfo.value,
      };
      reset();
      return result;
    }
    return null;
  }

  function reset() {
    magSelecting.value = false;
    magSourcePos.value = null;
    magSelectedCells.value = [];
    magSynthesisInfo.value = null;
  }

  return {
    magSelecting,
    magSourcePos,
    magTargetsNeeded,
    magSelectedCells,
    magSynthesisInfo,
    startSelection,
    selectCell,
    cancelSelection: reset,
  };
}
