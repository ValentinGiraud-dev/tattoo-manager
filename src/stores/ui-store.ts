import { create } from "zustand";

export type AppPage = "dashboard" | "clients" | "sessions" | "products";

type UIState = {
  page: AppPage;
  setPage: (page: AppPage) => void;
};

export const useUIStore = create<UIState>((set) => ({
  page: "dashboard",
  setPage: (page) => set({ page }),
}));
