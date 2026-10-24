import { invoke } from "@tauri-apps/api/core";
import { create } from "zustand";

export type SessionStatus = "PLANNED" | "COMPLETED" | "CANCELLED" | "RESCHEDULED" | "NO_SHOW";

export interface SessionListItem {
  id: string;
  clientId: string;
  projectId: string | null;
  projectTitle: string | null;
  title: string | null;
  date: string;
  /** Heure locale de début « HH:MM ». */
  startTime: string | null;
  durationMinutes: number | null;
  status: SessionStatus;
  /** Prix convenu, en centimes. */
  priceCents: number | null;
  bodyArea: string | null;
  description: string | null;
  notes: string | null;
  /** La tatoueuse a expliqué les règles d'hygiène après le tatouage. */
  aftercareExplained: boolean;
  createdAt: string;
  updatedAt: string;
  clientFirstName: string;
  clientLastName: string;
  /** Nombre de produits liés. Au-delà de zéro, le client ne change plus. */
  usageCount: number;
  /** Acomptes ou paiements rattachés : le client ne change plus non plus. */
  moneyCount: number;
  /** Absences du client, toutes séances confondues. */
  clientNoShowCount: number;
  archivedAt: string | null;
  clientArchived: boolean;
  projectArchived: boolean;
}

export interface SessionInput {
  clientId: string;
  projectId: string | null;
  title: string | null;
  date: string;
  startTime: string | null;
  durationMinutes: number | null;
  status: SessionStatus;
  priceCents: number | null;
  bodyArea: string | null;
  description: string | null;
  notes: string | null;
}

/** Champs d'enregistrement à partir d'une séance déjà chargée. */
export function sessionToInput(
  session: SessionListItem,
  status: SessionStatus = session.status,
): SessionInput {
  return {
    clientId: session.clientId,
    projectId: session.projectId,
    title: session.title,
    date: session.date,
    startTime: session.startTime,
    durationMinutes: session.durationMinutes,
    status,
    priceCents: session.priceCents,
    bodyArea: session.bodyArea,
    description: session.description,
    notes: session.notes,
  };
}

export interface SessionRemoval {
  sessionId: string;
  archived: boolean;
  canDelete: boolean;
  usageCount: number;
  formCount: number;
  documentCount: number;
  paymentCount: number;
  depositCount: number;
}

interface SessionsState {
  sessions: SessionListItem[];
  search: string;
  showArchived: boolean;
  loading: boolean;
  error: string | null;
  load: (search?: string, archived?: boolean) => Promise<void>;
  create: (input: SessionInput) => Promise<SessionListItem>;
  update: (id: string, input: SessionInput) => Promise<SessionListItem>;
  setAftercareExplained: (id: string, explained: boolean) => Promise<SessionListItem>;
  get: (id: string) => Promise<SessionListItem>;
  previewRemoval: (id: string) => Promise<SessionRemoval>;
  remove: (id: string) => Promise<void>;
  archive: (id: string) => Promise<void>;
  restore: (id: string) => Promise<void>;
  /** Séances entre deux dates incluses (planning). */
  between: (from: string, to: string) => Promise<SessionListItem[]>;
  /** Séances prévues ou faites qui chevauchent le créneau, le même jour. */
  overlaps: (
    date: string,
    startTime: string,
    durationMinutes: number,
    excludeId: string | null,
  ) => Promise<SessionListItem[]>;
}

export const useSessionsStore = create<SessionsState>((set, get) => ({
  sessions: [],
  search: "",
  showArchived: false,
  loading: false,
  error: null,
  load: async (search = get().search, archived = get().showArchived) => {
    set({ loading: true, search, showArchived: archived });
    try {
      const sessions = await invoke<SessionListItem[]>("list_sessions", { search, archived });
      set({ sessions, loading: false, error: null });
    } catch (error) {
      set({ loading: false, error: String(error) });
    }
  },
  create: async (input) => {
    const session = await invoke<SessionListItem>("create_session", { input });
    await get().load();
    return session;
  },
  update: async (id, input) => {
    const session = await invoke<SessionListItem>("update_session", { id, input });
    await get().load();
    return session;
  },
  setAftercareExplained: async (id, explained) => {
    const session = await invoke<SessionListItem>("set_aftercare_explained", { id, explained });
    await get().load();
    return session;
  },
  get: (id) => invoke<SessionListItem>("get_session", { id }),
  previewRemoval: (id) => invoke<SessionRemoval>("preview_session_removal", { id }),
  remove: async (id) => {
    await invoke("delete_session", { id });
    await get().load();
  },
  archive: async (id) => {
    await invoke("archive_session", { id });
    await get().load();
  },
  restore: async (id) => {
    await invoke("restore_session", { id });
    await get().load();
  },
  between: (from, to) => invoke<SessionListItem[]>("list_sessions_between", { from, to }),
  overlaps: (date, startTime, durationMinutes, excludeId) =>
    invoke<SessionListItem[]>("find_session_overlaps", {
      date,
      startTime,
      durationMinutes,
      excludeId,
    }),
}));
