import { create } from "zustand";

export type AppPage =
  "dashboard" | "planning" | "clients" | "sessions" | "products" | "reports" | "settings";

/** Demande d'ouverture faite depuis un autre écran (planning, fiche client…). */
export type SessionIntent =
  | { kind: "open"; sessionId: string }
  | { kind: "new"; date: string; startTime: string | null; clientId?: string; projectId?: string };

type UIState = {
  page: AppPage;
  setPage: (page: AppPage) => void;
  /** Un formulaire ouvert contient des modifications non enregistrées. */
  unsavedChanges: boolean;
  setUnsavedChanges: (value: boolean) => void;
  /** Lue puis effacée par l'écran Séances. */
  sessionIntent: SessionIntent | null;
  openSession: (sessionId: string) => void;
  newSession: (draft: Omit<Extract<SessionIntent, { kind: "new" }>, "kind">) => void;
  takeSessionIntent: () => SessionIntent | null;
};

export const useUIStore = create<UIState>((set, get) => ({
  page: "dashboard",
  setPage: (page) => set({ page }),
  unsavedChanges: false,
  setUnsavedChanges: (unsavedChanges) => set({ unsavedChanges }),
  sessionIntent: null,
  openSession: (sessionId) => set({ page: "sessions", sessionIntent: { kind: "open", sessionId } }),
  newSession: (draft) => set({ page: "sessions", sessionIntent: { kind: "new", ...draft } }),
  takeSessionIntent: () => {
    const intent = get().sessionIntent;
    if (intent) set({ sessionIntent: null });
    return intent;
  },
}));
