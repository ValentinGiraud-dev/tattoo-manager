import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";
import { errorMessage, type SecurityStatus } from "./security-store";

export type BackupSettings = {
  folder: string | null;
  lastBackupAt: string | null;
  lastCheckAt: string | null;
  lastFingerprint: string | null;
  lastError: string | null;
};

export type BackupEntry = {
  name: string;
  createdAt: string | null;
  appVersion: string | null;
  documents: number;
  sizeBytes: number;
  /** Faux si la sauvegarde est incomplète. */
  readable: boolean;
};

export type BackupOutcome = {
  result: "CREATED" | "UNCHANGED" | "SKIPPED";
  settings: BackupSettings;
};

export type RestoreInput = {
  folder: string;
  name: string;
  password?: string;
  recoveryKey?: string;
  newPassword?: string;
};

export type RestoreOutcome = { status: SecurityStatus; previousData: string };

type BackupState = {
  settings: BackupSettings | null;
  running: boolean;
  error: string | null;
  load: () => Promise<void>;
  setFolder: (folder: string | null) => Promise<void>;
  runNow: () => Promise<BackupOutcome>;
  /** Appelée au déverrouillage puis régulièrement : sauvegarde si plus de 24 h. */
  runIfDue: () => Promise<void>;
  list: (folder?: string) => Promise<BackupEntry[]>;
  restore: (input: RestoreInput) => Promise<RestoreOutcome>;
};

export const useBackupStore = create<BackupState>((set, get) => ({
  settings: null,
  running: false,
  error: null,
  load: async () => {
    try {
      set({ settings: await invoke<BackupSettings>("get_backup_settings"), error: null });
    } catch (error) {
      set({ error: errorMessage(error) });
    }
  },
  setFolder: async (folder) => {
    const settings = await invoke<BackupSettings>("set_backup_folder", { folder });
    set({ settings });
  },
  runNow: async () => {
    set({ running: true });
    try {
      const outcome = await invoke<BackupOutcome>("run_backup");
      set({ settings: outcome.settings });
      return outcome;
    } catch (error) {
      await get().load();
      throw error;
    } finally {
      set({ running: false });
    }
  },
  runIfDue: async () => {
    if (get().running) return;
    set({ running: true });
    try {
      const outcome = await invoke<BackupOutcome>("run_backup_if_due");
      set({ settings: outcome.settings });
    } catch {
      // L'erreur est enregistrée dans les réglages (lastError) et affichée par la barre latérale.
      await get().load();
    } finally {
      set({ running: false });
    }
  },
  list: (folder) => invoke<BackupEntry[]>("list_backups", { folder: folder ?? null }),
  restore: (input) => invoke<RestoreOutcome>("restore_backup", { input }),
}));
