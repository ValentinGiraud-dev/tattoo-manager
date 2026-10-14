import { invoke } from "@tauri-apps/api/core";
import { create } from "zustand";

export interface LotSummary {
  id: string;
  name: string;
  lotNumber: string;
  creationDate: string | null;
  expirationDate: string;
  singleUse: boolean;
  afterOpeningMonths: number | null;
  productUrl: string | null;
  createdAt: string;
  updatedAt: string;
  stock: number;
  sealedCount: number;
  openedCount: number;
  movementCount: number;
  expired: boolean;
}

export interface CreateLotInput {
  name: string;
  lotNumber: string;
  creationDate: string | null;
  expirationDate: string;
  singleUse: boolean;
  afterOpeningMonths: number | null;
  productUrl: string | null;
  quantity: number;
}

export interface UpdateLotInput {
  name: string;
  lotNumber: string;
  creationDate: string | null;
  expirationDate: string;
  afterOpeningMonths: number | null;
  productUrl: string | null;
}

export interface UnitView {
  id: string;
  lotId: string;
  openedAt: string | null;
  inStock: boolean;
  exitType: string | null;
  exitMovementId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface StockMovement {
  id: string;
  lotId: string;
  unitId: string | null;
  sessionId: string | null;
  type: string;
  quantity: number;
  reason: string | null;
  createdAt: string;
}

export interface LotSessionItem {
  sessionId: string;
  lotId: string | null;
  unitId: string | null;
  createdAt: string;
  date: string;
  status: string;
  bodyArea: string | null;
  clientFirstName: string;
  clientLastName: string;
  quantity: number;
}

export interface SessionUsageItem {
  id: string;
  sessionId: string;
  lotId: string | null;
  unitId: string | null;
  createdAt: string;
  name: string;
  lotNumber: string;
  expirationDate: string;
  singleUse: boolean;
  openedAt: string | null;
  quantity: number;
  expired: boolean;
}

export interface LinkableItem {
  lotId: string;
  unitId: string | null;
  name: string;
  lotNumber: string;
  expirationDate: string;
  singleUse: boolean;
  stock: number;
  openedAt: string | null;
  expired: boolean;
}

export interface RecordMovementInput {
  lotId: string;
  movementType: string;
  quantity: number;
  reason: string | null;
}

interface ProductsState {
  lots: LotSummary[];
  search: string;
  loading: boolean;
  error: string | null;
  load: (search?: string) => Promise<void>;
  get: (id: string) => Promise<LotSummary>;
  find: (name: string, lotNumber: string) => Promise<LotSummary | null>;
  create: (input: CreateLotInput) => Promise<LotSummary>;
  update: (id: string, input: UpdateLotInput) => Promise<LotSummary>;
  listUnits: (lotId: string) => Promise<UnitView[]>;
  openUnit: (unitId: string, openedAt: string) => Promise<UnitView>;
  exitUnit: (unitId: string, movementType: string) => Promise<UnitView>;
  recordMovement: (input: RecordMovementInput) => Promise<LotSummary>;
  undoMovement: (movementId: string) => Promise<LotSummary>;
  listMovements: (lotId: string) => Promise<StockMovement[]>;
  listSessions: (lotId: string) => Promise<LotSessionItem[]>;
  listSessionUsages: (sessionId: string) => Promise<SessionUsageItem[]>;
  listLinkable: (sessionId: string, search?: string) => Promise<LinkableItem[]>;
  linkToSession: (input: {
    sessionId: string;
    lotId: string | null;
    unitId: string | null;
    quantity: number | null;
  }) => Promise<SessionUsageItem>;
}

export const useProductsStore = create<ProductsState>((set, get) => ({
  lots: [],
  search: "",
  loading: false,
  error: null,
  load: async (search = get().search) => {
    set({ loading: true, search });
    try {
      const lots = await invoke<LotSummary[]>("list_lots", { search });
      set({ lots, loading: false, error: null });
    } catch (error) {
      set({ loading: false, error: String(error) });
    }
  },
  get: (id) => invoke<LotSummary>("get_lot", { id }),
  find: (name, lotNumber) =>
    invoke<LotSummary | null>("find_lot", { name, lotNumber }),
  create: async (input) => {
    const lot = await invoke<LotSummary>("create_lot", { input });
    await get().load();
    return lot;
  },
  update: async (id, input) => {
    const lot = await invoke<LotSummary>("update_lot", { id, input });
    await get().load();
    return lot;
  },
  listUnits: (lotId) => invoke<UnitView[]>("list_lot_units", { lotId }),
  openUnit: (unitId, openedAt) => invoke<UnitView>("open_unit", { unitId, openedAt }),
  exitUnit: (unitId, movementType) =>
    invoke<UnitView>("exit_unit", { unitId, movementType }),
  recordMovement: async (input) => {
    const lot = await invoke<LotSummary>("record_lot_movement", { input });
    await get().load();
    return lot;
  },
  undoMovement: async (movementId) => {
    const lot = await invoke<LotSummary>("undo_lot_movement", { movementId });
    await get().load();
    return lot;
  },
  listMovements: (lotId) => invoke<StockMovement[]>("list_lot_movements", { lotId }),
  listSessions: (lotId) => invoke<LotSessionItem[]>("list_lot_sessions", { lotId }),
  listSessionUsages: (sessionId) =>
    invoke<SessionUsageItem[]>("list_session_usages", { sessionId }),
  listLinkable: (sessionId, search) =>
    invoke<LinkableItem[]>("list_linkable_usages", { sessionId, search }),
  linkToSession: (input) => invoke<SessionUsageItem>("link_session_usage", { input }),
}));
