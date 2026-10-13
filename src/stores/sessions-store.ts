import { invoke } from "@tauri-apps/api/core";
import { create } from "zustand";

export type SessionStatus = "PLANNED" | "COMPLETED" | "CANCELLED" | "RESCHEDULED";

export interface SessionListItem {
  id: string;
  clientId: string;
  date: string;
  status: SessionStatus;
  bodyArea: string | null;
  description: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
  clientFirstName: string;
  clientLastName: string;
}

export interface SessionInput {
  clientId: string;
  date: string;
  status: SessionStatus;
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
}));
