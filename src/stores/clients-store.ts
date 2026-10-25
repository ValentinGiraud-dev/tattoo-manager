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
  archivedAt: string | null;
}

/** Client tel que la liste le renvoie, avec le nombre de séances. */
export interface ClientListItem extends Client {
  sessionCount: number;
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

export interface ArchiveStockLine {
  lotId: string;
  name: string;
  lotNumber: string;
  quantity: number;
}

export interface ClientArchivePreview {
  clientId: string;
  archived: boolean;
  canDelete: boolean;
  sessions: { id: string; date: string; upcoming: boolean }[];
  projects: { id: string; title: string }[];
  depositCount: number;
  paymentCount: number;
  documentCount: number;
  stock: ArchiveStockLine[];
}

interface ClientsState {
  clients: ClientListItem[];
  search: string;
  showArchived: boolean;
  loading: boolean;
  error: string | null;
  load: (search?: string, archived?: boolean) => Promise<void>;
  /** Clients actifs, sans toucher à la liste affichée. */
  listActive: () => Promise<ClientListItem[]>;
  create: (input: ClientInput) => Promise<Client>;
  update: (id: string, input: ClientInput) => Promise<Client>;
  get: (id: string) => Promise<Client>;
  previewRemoval: (id: string) => Promise<ClientArchivePreview>;
  /** Refusé par le backend si le client a des séances, projets ou acomptes. */
  remove: (id: string) => Promise<void>;
  archive: (id: string) => Promise<void>;
  restore: (id: string) => Promise<void>;
  /** Séances du client, de la plus récente à la plus ancienne. */
  listSessions: (clientId: string) => Promise<SessionListItem[]>;
  /** Produits liés aux séances du client, liens annulés compris. */
  listUsages: (clientId: string) => Promise<SessionUsageItem[]>;
}

export const useClientsStore = create<ClientsState>((set, get) => ({
  clients: [],
  search: "",
  showArchived: false,
  loading: false,
  error: null,
  load: async (search = get().search, archived = get().showArchived) => {
    set({ loading: true, search, showArchived: archived });
    try {
      const clients = await invoke<ClientListItem[]>("list_clients", { search, archived });
      set({ clients, loading: false, error: null });
    } catch (error) {
      set({ loading: false, error: String(error) });
    }
  },
  listActive: () => invoke<ClientListItem[]>("list_clients", { search: null, archived: false }),
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
  get: (id) => invoke<Client>("get_client", { id }),
  previewRemoval: (id) => invoke<ClientArchivePreview>("preview_client_archive", { id }),
  remove: async (id) => {
    await invoke("delete_client", { id });
    await get().load();
  },
  archive: async (id) => {
    await invoke("archive_client", { id });
    await get().load();
  },
  restore: async (id) => {
    await invoke("restore_client", { id });
    await get().load();
  },
  listSessions: (clientId) => invoke<SessionListItem[]>("list_client_sessions", { clientId }),
  listUsages: (clientId) => invoke<SessionUsageItem[]>("list_client_usages", { clientId }),
}));
