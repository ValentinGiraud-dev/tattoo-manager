import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";
import { errorMessage } from "./security-store";

export type AuditGroup = "clients" | "sessions" | "billing" | "stock" | "app";

export type AuditChange = { field: string; before: unknown; after: unknown };

export type AuditEntry = {
  seq: number;
  /** UTC, `AAAA-MM-JJTHH:MM:SS`. */
  occurredAt: string;
  /** `CREATE`, `UPDATE`, `DELETE` ou un code d'événement de l'app. */
  action: string;
  entity: string;
  entityId: string | null;
  label: string | null;
  clientId: string | null;
  sessionId: string | null;
  lotId: string | null;
  changes: AuditChange[];
};

export type AuditPage = {
  entries: AuditEntry[];
  /** Noms des fiches citées, par identifiant. */
  names: Record<string, string>;
  hasMore: boolean;
};

export type AuditQuery = {
  from?: string | null;
  to?: string | null;
  group?: AuditGroup | null;
  clientId?: string | null;
  sessionId?: string | null;
  lotId?: string | null;
  /** Fiche produit : `entity` vaut `product`, `entityId` est l'identifiant. */
  entity?: string | null;
  entityId?: string | null;
  beforeSeq?: number | null;
  limit?: number;
};

export type AuditPeriod = "all" | "today" | "week" | "month" | "custom";

/** Filtre de l'écran Journal. `from` / `to` : dates locales, calculées pour les préréglages. */
export type AuditFilter = {
  period: AuditPeriod;
  from: string | null;
  to: string | null;
  group: AuditGroup | null;
};

function queryOf({ from, to, group }: AuditFilter): AuditQuery {
  return { from, to, group };
}

/** Lit une page du journal (historique d'une fiche ou écran Journal). */
export function fetchAuditPage(query: AuditQuery): Promise<AuditPage> {
  return invoke<AuditPage>("list_audit_entries", { query });
}

/** Ajoute une page plus ancienne à celle déjà affichée. */
export function appendPage(current: AuditPage, next: AuditPage): AuditPage {
  return {
    entries: [...current.entries, ...next.entries],
    names: { ...current.names, ...next.names },
    hasMore: next.hasMore,
  };
}

interface AuditState {
  filter: AuditFilter;
  page: AuditPage | null;
  loading: boolean;
  loadingMore: boolean;
  error: string | null;
  load: (filter: AuditFilter) => Promise<void>;
  loadMore: () => Promise<void>;
}

/** Numéro de la dernière demande : une réponse plus ancienne est ignorée. */
let request = 0;

export const useAuditStore = create<AuditState>((set, get) => ({
  filter: { period: "all", from: null, to: null, group: null },
  page: null,
  loading: false,
  loadingMore: false,
  error: null,
  load: async (filter) => {
    const current = ++request;
    set({ filter, loading: true, loadingMore: false, error: null });
    try {
      const page = await fetchAuditPage(queryOf(filter));
      if (current === request) set({ page, loading: false });
    } catch (error) {
      if (current === request) set({ error: errorMessage(error), loading: false });
    }
  },
  loadMore: async () => {
    const { page, filter, loadingMore } = get();
    if (!page || !page.hasMore || loadingMore) return;
    const last = page.entries[page.entries.length - 1];
    const current = request;
    set({ loadingMore: true, error: null });
    try {
      const next = await fetchAuditPage({ ...queryOf(filter), beforeSeq: last.seq });
      if (current === request) set({ page: appendPage(page, next) });
    } catch (error) {
      if (current === request) set({ error: errorMessage(error) });
    } finally {
      set({ loadingMore: false });
    }
  },
}));
