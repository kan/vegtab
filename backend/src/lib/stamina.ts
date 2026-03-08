const MAX_STAMINA = 5;
const RECOVER_INTERVAL_MS = 30 * 60 * 1000; // 30 minutes

export interface StaminaState {
  stamina: number;
  lastStaminaRecoverAt: string;
}

/** Calculate current stamina including time-based recovery */
export function calculateCurrentStamina(state: StaminaState): {
  stamina: number;
  lastRecoverAt: string;
} {
  const lastRecover = new Date(state.lastStaminaRecoverAt).getTime();
  const now = Date.now();
  const elapsed = now - lastRecover;

  if (state.stamina >= MAX_STAMINA || elapsed < RECOVER_INTERVAL_MS) {
    return { stamina: state.stamina, lastRecoverAt: state.lastStaminaRecoverAt };
  }

  const recoveries = Math.floor(elapsed / RECOVER_INTERVAL_MS);
  const newStamina = Math.min(MAX_STAMINA, state.stamina + recoveries);
  const newLastRecover = new Date(lastRecover + recoveries * RECOVER_INTERVAL_MS).toISOString();

  return { stamina: newStamina, lastRecoverAt: newLastRecover };
}

export { MAX_STAMINA };
