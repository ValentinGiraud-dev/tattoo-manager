import { invoke } from "@tauri-apps/api/core";
import { create } from "zustand";

export type SessionStatus = "PLANNED" | "COMPLETED" | "CANCELLED" | "RESCHEDULED" | "NO_SHOW";

export interface SessionListItem {
  id: string;
  clientId: string;
  projectId: string | null;
  projectTitle: string | null;
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
}

export interface SessionInput {
  clientId: string;
  projectId: string | null;
  date: string;
  startTime: string | null;
  durationMinutes: number | null;
  status: SessionStatus;
  priceCents: number | null;
  bodyArea: string | null;
  description: string | null;
  notes: string | null;
}

interface SessionsState {
  sessions: SessionListItem[];
  search: string;
  loading: boolean;
  error: string | null;
  load: (search?: string) => Promise<void>;
  create: (input: SessionInput) => Promise<SessionListItem>;
  update: (id: string, input: SessionInput) => Promise<SessionListItem>;
  get: (id: string) => Promise<SessionListItem>;
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
  loading: false,
  error: null,
  load: async (search = get().search) => {
    set({ loading: true, search });
    try {
      const sessions = await invoke<SessionListItem[]>("list_sessions", { search });
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
  get: (id) => invoke<SessionListItem>("get_session", { id }),
  between: (from, to) => invoke<SessionListItem[]>("list_sessions_between", { from, to }),
  overlaps: (date, startTime, durationMinutes, excludeId) =>
    invoke<SessionListItem[]>("find_session_overlaps", {
      date,
      startTime,
      durationMinutes,
      excludeId,
    }),
}));
