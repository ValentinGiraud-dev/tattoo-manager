import { invoke } from "@tauri-apps/api/core";
import { create } from "zustand";

export interface Client {
  id: string;
  firstName: string;
  lastName: string;
  birthDate: string | null;
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
}));
