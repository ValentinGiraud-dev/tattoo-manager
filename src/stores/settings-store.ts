import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";

export type WindowSettings = {
  width: number;
  height: number;
};

export type StudioSettings = {
  /** « Professionnel réalisant l'acte » sur le consentement. */
  professionalName: string;
  /** « Fait à » sur le consentement. */
  city: string;
};

export type AppSettings = {
  locale: string;
  window: WindowSettings;
  studio: StudioSettings;
};

export type AppPaths = {
  root: string;
  database: string;
  photos: string;
  documents: string;
  backups: string;
  settings: string;
};

type SettingsState = {
  settings: AppSettings | null;
  paths: AppPaths | null;
  loaded: boolean;
  error: string | null;
  load: () => Promise<void>;
  updateSettings: (settings: AppSettings) => Promise<void>;
};

export const useSettingsStore = create<SettingsState>((set) => ({
  settings: null,
  paths: null,
  loaded: false,
  error: null,
  load: async () => {
    try {
      const [settings, paths] = await Promise.all([
        invoke<AppSettings>("get_settings"),
        invoke<AppPaths>("get_app_paths"),
      ]);
      set({ settings, paths, loaded: true, error: null });
    } catch (error: unknown) {
      set({
        loaded: true,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  },
  updateSettings: async (settings) => {
    const saved = await invoke<AppSettings>("update_settings", { settings });
    set({ settings: saved, error: null });
  },
}));
