import { create } from "zustand";

export type AppPage =
  "dashboard" | "planning" | "clients" | "sessions" | "products" | "reports" | "settings";

export const PAGE_LABELS: Record<AppPage, string> = {
  dashboard: "Accueil",
  planning: "Planning",
  clients: "Clients",
  sessions: "Séances",
  products: "Produits",
  reports: "Rapports",
  settings: "Paramètres",
};

/** Demande d'ouverture faite depuis un autre écran (planning, fiche client…). */
export type SessionIntent =
  | { kind: "open"; sessionId: string }
  | { kind: "new"; date: string; startTime: string | null; clientId?: string; projectId?: string };

/** Fiche affichée dans l'écran courant, pour pouvoir y revenir. */
export type OpenDetail = { kind: "session" | "lot" | "client"; id: string };

export type Origin = { page: AppPage; detail: OpenDetail | null };

type UIState = {
  page: AppPage;
  /** Navigation par le menu : on repart de la liste, sans écran d'origine. */
  setPage: (page: AppPage) => void;
  /** Change à chaque passage par le menu : l'écran est remonté sur sa liste. */
  visit: number;
  /**
   * Écran d'où vient une ouverture directe (lot ouvert depuis l'accueil, client
   * depuis une séance…). Le bouton retour de la fiche y ramène.
   */
  origin: Origin | null;
  goBack: () => void;
  /** Fiche ouverte dans l'écran courant (tenue à jour par les écrans). */
  detail: OpenDetail | null;
  setDetail: (detail: OpenDetail | null) => void;
  /** Un formulaire ouvert contient des modifications non enregistrées. */
  unsavedChanges: boolean;
  setUnsavedChanges: (value: boolean) => void;
  /** Lue puis effacée par l'écran Séances. */
  sessionIntent: SessionIntent | null;
  openSession: (sessionId: string) => void;
  newSession: (draft: Omit<Extract<SessionIntent, { kind: "new" }>, "kind">) => void;
  takeSessionIntent: () => SessionIntent | null;
  /** Lot à ouvrir dans Produits. */
  lotIntent: string | null;
  openLot: (lotId: string) => void;
  takeLotIntent: () => string | null;
  /** Client à ouvrir dans Clients. */
  clientIntent: string | null;
  openClient: (clientId: string) => void;
  takeClientIntent: () => string | null;
};

export const useUIStore = create<UIState>((set, get) => {
  /** Change d'écran en retenant l'écran de départ (s'il est différent). */
  function jump(page: AppPage, patch: Partial<UIState>) {
    const { page: from, detail, origin } = get();
    set({ ...patch, page, origin: from === page ? origin : { page: from, detail } });
  }

  function reopen(detail: OpenDetail | null): Partial<UIState> {
    if (!detail) return {};
    if (detail.kind === "session") return { sessionIntent: { kind: "open", sessionId: detail.id } };
    if (detail.kind === "lot") return { lotIntent: detail.id };
    return { clientIntent: detail.id };
  }

  return {
    page: "dashboard",
    setPage: (page) =>
      set((state) => ({ page, origin: null, detail: null, visit: state.visit + 1 })),
    visit: 0,
    origin: null,
    goBack: () => {
      const origin = get().origin;
      if (origin) set({ page: origin.page, origin: null, ...reopen(origin.detail) });
    },
    detail: null,
    setDetail: (detail) => {
      const current = get().detail;
      if (current?.kind === detail?.kind && current?.id === detail?.id) return;
      set({ detail });
    },
    unsavedChanges: false,
    setUnsavedChanges: (unsavedChanges) => set({ unsavedChanges }),
    sessionIntent: null,
    openSession: (sessionId) => jump("sessions", { sessionIntent: { kind: "open", sessionId } }),
    newSession: (draft) => jump("sessions", { sessionIntent: { kind: "new", ...draft } }),
    takeSessionIntent: () => {
      const intent = get().sessionIntent;
      if (intent) set({ sessionIntent: null });
      return intent;
    },
    lotIntent: null,
    openLot: (lotId) => jump("products", { lotIntent: lotId }),
    takeLotIntent: () => {
      const intent = get().lotIntent;
      if (intent) set({ lotIntent: null });
      return intent;
    },
    clientIntent: null,
    openClient: (clientId) => jump("clients", { clientIntent: clientId }),
    takeClientIntent: () => {
      const intent = get().clientIntent;
      if (intent) set({ clientIntent: null });
      return intent;
    },
  };
});
