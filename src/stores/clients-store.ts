import { invoke } from "@tauri-apps/api/core";
import { create } from "zustand";
import type { SessionUsageItem } from "./products-store";
import type { SessionListItem } from "./sessions-store";

export interface Client {
  id: string;
  firstName: string;
  lastName: string;
  birthDate: string | null;
  address: string | null;
  email: string | null;
  phone: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ClientInput {
  firstName: string;
  lastName: string;
  birthDate: string | null;
  address: string | null;
  email: string | null;
  phone: string | null;
  notes: string | null;
}

interface ClientsState {
  clients: Client[];
  search: string;
  loading: boolean;
  error: string | null;
  load: (search?: string) => Promise<void>;
  create: (input: ClientInput) => Promise<Client>;
  update: (id: string, input: ClientInput) => Promise<Client>;
  /** Séances du client, de la plus récente à la plus ancienne. */
  listSessions: (clientId: string) => Promise<SessionListItem[]>;
  /** Produits liés aux séances du client, liens annulés compris. */
  listUsages: (clientId: string) => Promise<SessionUsageItem[]>;
}

export const useClientsStore = create<ClientsState>((set, get) => ({
  clients: [],
  search: "",
  loading: false,
  error: null,
  load: async (search = get().search) => {
    set({ loading: true, search });
    try {
      const clients = await invoke<Client[]>("list_clients", { search });
      set({ clients, loading: false, error: null });
    } catch (error) {
      set({ loading: false, error: String(error) });
    }
  },
  create: async (input) => {
    const client = await invoke<Client>("create_client", { input });
    await get().load();
    return client;
  },
  update: async (id, input) => {
    const client = await invoke<Client>("update_client", { id, input });
    await get().load();
    return client;
  },
  listSessions: (clientId) => invoke<SessionListItem[]>("list_client_sessions", { clientId }),
  listUsages: (clientId) => invoke<SessionUsageItem[]>("list_client_usages", { clientId }),
}));
