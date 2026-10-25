import { create } from "zustand";

export type AppPage =
  | "dashboard"
  | "planning"
  | "clients"
  | "sessions"
  | "products"
  | "reports"
  | "journal"
  | "settings";

export const PAGE_LABELS: Record<AppPage, string> = {
  dashboard: "Accueil",
  planning: "Planning",
  clients: "Clients",
  sessions: "Séances",
  products: "Produits",
  reports: "Rapports",
  journal: "Journal",
  settings: "Paramètres",
};

/** Zone de la fiche séance à montrer à l'ouverture (accueil). */
export type SessionFocus = "documents" | "usages";

/** Demande d'ouverture faite depuis un autre écran (planning, fiche client…). */
export type SessionIntent =
  | { kind: "open"; sessionId: string; focus?: SessionFocus }
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
   * Écrans d'où viennent les ouvertures directes successives (lot ouvert depuis
   * l'accueil, client depuis une séance…), le plus récent en dernier. Le bouton
   * retour d'une fiche ramène au dernier, puis à celui d'avant, etc.
   */
  history: Origin[];
  goBack: () => void;
  /** Fiche ouverte dans l'écran courant (tenue à jour par les écrans). */
  detail: OpenDetail | null;
  setDetail: (detail: OpenDetail | null) => void;
  /** Un formulaire ouvert contient des modifications non enregistrées. */
  unsavedChanges: boolean;
  setUnsavedChanges: (value: boolean) => void;
  /** Lue puis effacée par l'écran Séances. */
  sessionIntent: SessionIntent | null;
  openSession: (sessionId: string, focus?: SessionFocus) => void;
  newSession: (draft: Omit<Extract<SessionIntent, { kind: "new" }>, "kind">) => void;
  takeSessionIntent: () => SessionIntent | null;
  /** Lot à ouvrir dans Produits. */
  lotIntent: string | null;
  openLot: (lotId: string) => void;
  takeLotIntent: () => string | null;
  /** Fiche produit à ouvrir dans Produits. */
  sheetIntent: string | null;
  openSheet: (sheetId: string) => void;
  takeSheetIntent: () => string | null;
  /** Client à ouvrir dans Clients. */
  clientIntent: string | null;
  openClient: (clientId: string) => void;
  takeClientIntent: () => string | null;
};

/** Au-delà, les retours les plus anciens sont oubliés. */
const MAX_HISTORY = 20;

/** Dernier écran d'où l'on vient, ou `null`. */
export function lastOrigin(state: { history: Origin[] }): Origin | null {
  return state.history[state.history.length - 1] ?? null;
}

export const useUIStore = create<UIState>((set, get) => {
  /** Change d'écran en retenant l'écran et la fiche de départ. */
  function jump(page: AppPage, patch: Partial<UIState>) {
    const { page: from, detail, history } = get();
    // Même écran sans fiche ouverte (liste) : rien à retenir.
    const stays = from === page && detail === null;
    set({
      ...patch,
      page,
      history: stays ? history : [...history, { page: from, detail }].slice(-MAX_HISTORY),
    });
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
      set((state) => ({ page, history: [], detail: null, visit: state.visit + 1 })),
    visit: 0,
    history: [],
    goBack: () => {
      const history = get().history;
      const origin = history[history.length - 1];
      if (!origin) return;
      set({
        page: origin.page,
        history: history.slice(0, -1),
        // La fiche d'arrivée se signale elle-même ; une liste n'en a pas.
        detail: null,
        ...reopen(origin.detail),
      });
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
    openSession: (sessionId, focus) =>
      jump("sessions", { sessionIntent: { kind: "open", sessionId, focus } }),
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
    sheetIntent: null,
    openSheet: (sheetId) => jump("products", { sheetIntent: sheetId }),
    takeSheetIntent: () => {
      const intent = get().sheetIntent;
      if (intent) set({ sheetIntent: null });
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
