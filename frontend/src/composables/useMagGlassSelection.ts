import { ref } from 'vue';
import type { Position } from '@vegtab/engine';

export interface ScopeSynthesisInfo {
  pos1: Position;
  pos2: Position;
}

export function useScopeSelection() {
  const scopeSelecting = ref(false);
  const scopeSourcePos = ref<Position | null>(null);
  const scopeTargetsNeeded = ref(0);
  const scopeSelectedCells = ref<Position[]>([]);
  const scopeSynthesisInfo = ref<ScopeSynthesisInfo | null>(null);

  /** Enter scope selection mode (user tapped a scope). */
  function startSelection(pos: Position, targets = 1, synthesis: ScopeSynthesisInfo | null = null) {
    scopeSelecting.value = true;
    scopeSourcePos.value = pos;
    scopeTargetsNeeded.value = targets;
    scopeSelectedCells.value = [];
    scopeSynthesisInfo.value = synthesis;
  }

  /**
   * Handle a cell tap during scope selection.
   * Returns the selected cells + synthesis info when selection is complete, or null if still selecting.
   */
  function selectCell(pos: Position): { cells: Position[]; source: Position; synthesis: ScopeSynthesisInfo | null } | null {
    if (!scopeSelecting.value) return null;
    // Don't allow selecting the scope itself
    if (scopeSourcePos.value && pos.row === scopeSourcePos.value.row && pos.col === scopeSourcePos.value.col) return null;
    // Don't allow duplicate selections
    if (scopeSelectedCells.value.some(p => p.row === pos.row && p.col === pos.col)) return null;

    scopeSelectedCells.value.push(pos);

    if (scopeSelectedCells.value.length >= scopeTargetsNeeded.value) {
      const result = {
        cells: [...scopeSelectedCells.value],
        source: scopeSourcePos.value!,
        synthesis: scopeSynthesisInfo.value,
      };
      reset();
      return result;
    }
    return null;
  }

  function reset() {
    scopeSelecting.value = false;
    scopeSourcePos.value = null;
    scopeSelectedCells.value = [];
    scopeSynthesisInfo.value = null;
  }

  return {
    scopeSelecting,
    scopeSourcePos,
    scopeTargetsNeeded,
    scopeSelectedCells,
    scopeSynthesisInfo,
    startSelection,
    selectCell,
    cancelSelection: reset,
  };
}
