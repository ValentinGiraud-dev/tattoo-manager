import { create } from "zustand";

export type AppPage = "dashboard" | "clients" | "sessions" | "products" | "settings";

type UIState = {
  page: AppPage;
  setPage: (page: AppPage) => void;
  /** Un formulaire ouvert contient des modifications non enregistrées. */
  unsavedChanges: boolean;
  setUnsavedChanges: (value: boolean) => void;
};

export const useUIStore = create<UIState>((set) => ({
  page: "dashboard",
  setPage: (page) => set({ page }),
  unsavedChanges: false,
  setUnsavedChanges: (unsavedChanges) => set({ unsavedChanges }),
}));
