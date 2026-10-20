import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";

export type LockState = "SETUP_REQUIRED" | "LOCKED" | "UNLOCKED";

export type SecurityStatus = {
  state: LockState;
  touchIdAvailable: boolean;
  touchIdEnabled: boolean;
  /** Données en clair d'une version précédente, chiffrées à la création du mot de passe. */
  hasPlaintextData: boolean;
  /** Base chiffrée sans fichier de clés : seule une restauration peut aider. */
  vaultMissing: boolean;
  autoLockMinutes: number;
  /** Rechiffrement interrompu : l'ancien ou le nouveau mot de passe le termine. */
  rotationPending: boolean;
};

export const AUTO_LOCK_CHOICES = [0, 2, 5, 10, 15, 30] as const;
export const MIN_PASSWORD_CHARS = 8;

type SecurityState = {
  status: SecurityStatus | null;
  error: string | null;
  /** Vrai dès le premier déverrouillage : l'app est alors montée et reste montée. */
  everUnlocked: boolean;
  /** Clé de secours à montrer une seule fois, juste après la création. */
  pendingRecoveryKey: string | null;
  load: () => Promise<void>;
  setup: (password: string) => Promise<void>;
  acknowledgeRecoveryKey: () => void;
  unlockWithPassword: (password: string) => Promise<void>;
  unlockWithRecoveryKey: (recoveryKey: string, newPassword: string) => Promise<void>;
  unlockWithTouchId: () => Promise<void>;
  lock: () => Promise<void>;
  changePassword: (currentPassword: string, newPassword: string) => Promise<void>;
  renewRecoveryKey: (password: string) => Promise<string>;
  /**
   * Rechiffre toutes les données sous une nouvelle clé, avec un nouveau mot de passe.
   * Renvoie la nouvelle clé de secours (à montrer une seule fois).
   */
  rotateKey: (currentPassword: string, newPassword: string) => Promise<string>;
  setTouchId: (enabled: boolean) => Promise<void>;
  setAutoLock: (minutes: number) => Promise<void>;
  /** Après une restauration, depuis l'écran qui l'a lancée. */
  applyStatus: (status: SecurityStatus) => void;
};

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export const useSecurityStore = create<SecurityState>((set, get) => {
  function applyStatus(status: SecurityStatus) {
    set((state) => ({
      status,
      error: null,
      everUnlocked: state.everUnlocked || status.state === "UNLOCKED",
    }));
  }

  return {
    status: null,
    error: null,
    everUnlocked: false,
    pendingRecoveryKey: null,
    applyStatus,
    load: async () => {
      try {
        applyStatus(await invoke<SecurityStatus>("get_security_status"));
      } catch (error) {
        set({ error: errorMessage(error) });
      }
    },
    setup: async (password) => {
      const recoveryKey = await invoke<string>("setup_security", { password });
      set({ pendingRecoveryKey: recoveryKey });
      // L'app ne s'affiche qu'une fois la clé de secours notée (voir SecurityGate).
      const status = await invoke<SecurityStatus>("get_security_status");
      set({ status, error: null });
    },
    acknowledgeRecoveryKey: () => {
      set((state) => ({
        pendingRecoveryKey: null,
        everUnlocked: state.everUnlocked || state.status?.state === "UNLOCKED",
      }));
    },
    unlockWithPassword: async (password) => {
      applyStatus(await invoke<SecurityStatus>("unlock_with_password", { password }));
    },
    unlockWithRecoveryKey: async (recoveryKey, newPassword) => {
      applyStatus(
        await invoke<SecurityStatus>("unlock_with_recovery_key", { recoveryKey, newPassword }),
      );
    },
    unlockWithTouchId: async () => {
      applyStatus(await invoke<SecurityStatus>("unlock_with_touch_id"));
    },
    lock: async () => {
      if (get().status?.state !== "UNLOCKED") return;
      applyStatus(await invoke<SecurityStatus>("lock_app"));
    },
    changePassword: async (currentPassword, newPassword) => {
      await invoke("change_password", { currentPassword, newPassword });
    },
    renewRecoveryKey: (password) => invoke<string>("renew_recovery_key", { password }),
    rotateKey: async (currentPassword, newPassword) => {
      try {
        return await invoke<string>("rotate_master_key", { currentPassword, newPassword });
      } finally {
        // Interrompue après le début, l'app est verrouillée : l'écran doit le montrer.
        await get().load();
      }
    },
    setTouchId: async (enabled) => {
      applyStatus(await invoke<SecurityStatus>("set_touch_id", { enabled }));
    },
    setAutoLock: async (minutes) => {
      applyStatus(await invoke<SecurityStatus>("set_auto_lock", { minutes }));
    },
  };
});
