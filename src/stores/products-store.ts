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
  categoryId: string | null;
  /** « Aiguilles › RL », `null` sans catégorie. */
  categoryPath: string | null;
  /** Fiche produit ; `null` pour un lot reçu avant les fiches (à rattacher). */
  productId: string | null;
  productName: string | null;
  productBrand: string | null;
  createdAt: string;
  updatedAt: string;
  stock: number;
  sealedCount: number;
  openedCount: number;
  movementCount: number;
  /** Nombre de séances où ce lot ou une de ses pièces a servi. */
  sessionCount: number;
  expired: boolean;
  archivedAt: string | null;
  /** La fiche produit du lot est archivée. Le lot reste utilisable. */
  productArchived: boolean;
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
  categoryId: string | null;
  /** Avec une fiche : nom, type, durée, lien et catégorie viennent de la fiche. */
  productId: string | null;
}

export interface UpdateLotInput {
  name: string;
  lotNumber: string;
  creationDate: string | null;
  expirationDate: string;
  afterOpeningMonths: number | null;
  productUrl: string | null;
  categoryId: string | null;
}

/** Fiche produit : ce que l'atelier achète et réachète. Les lots y sont rattachés. */
export interface ProductSheet {
  id: string;
  name: string;
  brand: string | null;
  /** « Dynamic Triple Black » : nom donné aux lots reçus avec la fiche. */
  displayName: string;
  categoryId: string | null;
  categoryPath: string | null;
  singleUse: boolean;
  afterOpeningMonths: number | null;
  productUrl: string | null;
  createdAt: string;
  updatedAt: string;
  lotCount: number;
  /** Stock des lots non périmés (pièces en stock pour l'usage multiple). */
  stock: number;
  /** Stock restant dans des lots périmés. */
  expiredStock: number;
  /** Seuil réglé sur la fiche : `null` = celui de la catégorie, 0 = pas d'alerte. */
  lowStockThreshold: number | null;
  /** Seuil qui s'applique, d'où qu'il vienne ; `null` : pas d'alerte. */
  alertThreshold: number | null;
  /** Catégorie d'où vient le seuil appliqué ; `null` s'il est réglé sur la fiche. */
  alertSource: string | null;
  /** Stock utilisable inférieur ou égal au seuil appliqué (calculé en Rust). */
  lowStock: boolean;
  archivedAt: string | null;
}

export type LowStockMode = "EACH" | "TOTAL";

/** Seuil d'une catégorie ; `mode` et `threshold` à `null` : pas d'alerte. */
export interface LowStockSetting {
  mode: LowStockMode | null;
  threshold: number | null;
}

export interface SheetAlert {
  sheetId: string;
  displayName: string;
  singleUse: boolean;
  stock: number;
  threshold: number;
  /** Catégorie d'où vient le seuil, `null` s'il est réglé sur la fiche. */
  source: string | null;
}

export interface CategoryAlert {
  categoryId: string;
  path: string;
  /** Somme du stock des fiches de la branche. */
  stock: number;
  threshold: number;
  sheetCount: number;
}

export interface LowStockReport {
  sheets: SheetAlert[];
  categories: CategoryAlert[];
}

export interface ProductSheetInput {
  name: string;
  brand: string | null;
  categoryId: string | null;
  singleUse: boolean;
  afterOpeningMonths: number | null;
  productUrl: string | null;
  lowStockThreshold: number | null;
}

/** Catégorie de produits, dans l'ordre de l'arbre (parent puis enfants). */
export interface Category {
  id: string;
  parentId: string | null;
  name: string;
  /** 0 pour une catégorie racine. */
  depth: number;
  /** « Aiguilles › RL ». */
  path: string;
  /** Produits rangés directement ici : fiches et lots sans fiche. */
  lotCount: number;
  /** Produits rangés ici ou dans une sous-catégorie. */
  totalLotCount: number;
  childCount: number;
  lowStockThreshold: number | null;
  /** `EACH` : seuil de chaque fiche de la branche ; `TOTAL` : seuil de leur somme. */
  lowStockMode: LowStockMode | null;
}

export interface CategoryInput {
  name: string;
  parentId: string | null;
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
  /** La pièce a servi dans au moins une séance. */
  usedInSessions: boolean;
  /** Dernier jour d'utilisation, calculé en Rust. */
  usefulUntil: string;
  expired: boolean;
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
  voidReason: string | null;
  clientArchived: boolean;
  sessionArchived: boolean;
}

export interface SessionUsageItem {
  id: string;
  sessionId: string;
  lotId: string | null;
  unitId: string | null;
  /** Lot du produit, que le lien porte sur le lot ou sur une de ses pièces. */
  lotRef: string;
  createdAt: string;
  name: string;
  lotNumber: string;
  expirationDate: string;
  singleUse: boolean;
  openedAt: string | null;
  afterOpeningMonths: number | null;
  quantity: number;
  /** Date de la séance ; `expired` est évalué à cette date. */
  sessionDate: string;
  usefulUntil: string;
  expired: boolean;
  /** Renseigné si le lien a été annulé. */
  voidReason: string | null;
  voidedAt: string | null;
  lotArchived: boolean;
  productArchived: boolean;
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
  afterOpeningMonths: number | null;
  usefulUntil: string;
  expired: boolean;
  /** Fiche produit du lot ; `null` : lot sans fiche (non surveillé). */
  productId: string | null;
  productName: string | null;
  /** Stock utilisable de la fiche (tous ses lots non périmés). */
  productStock: number | null;
  /** Seuil de stock bas de la fiche, s'il y en a un. */
  alertThreshold: number | null;
  /** La fiche est déjà en stock bas (calculé en Rust). */
  lowStock: boolean;
}

export interface RecordMovementInput {
  lotId: string;
  movementType: string;
  quantity: number;
  reason: string | null;
}

export interface SheetRemoval {
  sheetId: string;
  archived: boolean;
  canDelete: boolean;
  lotCount: number;
}

export interface LotRemoval {
  lotId: string;
  archived: boolean;
  canDelete: boolean;
  sessionCount: number;
}

interface ProductsState {
  categories: Category[];
  categoriesError: string | null;
  loadCategories: () => Promise<void>;
  createCategory: (input: CategoryInput) => Promise<Category>;
  updateCategory: (id: string, input: CategoryInput) => Promise<Category>;
  /** Le contenu (sous-catégories, lots) remonte d'un niveau. */
  deleteCategory: (id: string) => Promise<void>;
  setCategoryLowStock: (id: string, setting: LowStockSetting) => Promise<Category>;
  /** Fiches et catégories en stock bas (relu avec les lots). */
  lowStock: LowStockReport;
  lots: LotSummary[];
  /** Fiches produit (même recherche que les lots). */
  sheets: ProductSheet[];
  search: string;
  /** `true` : la liste ne montre que les fiches archivées. */
  showArchived: boolean;
  loading: boolean;
  error: string | null;
  /** Charge les lots et les fiches produit. */
  load: (search?: string, archived?: boolean) => Promise<void>;
  /** Tous les lots, sans recherche (lots d'une fiche, lots à rattacher). */
  listAllLots: () => Promise<LotSummary[]>;
  /** Toutes les fiches, sans recherche (choix d'une fiche). */
  listAllSheets: () => Promise<ProductSheet[]>;
  getSheet: (id: string) => Promise<ProductSheet>;
  /** Crée une fiche et y rattache `attachLotIds` (lots existants) en une fois. */
  createSheet: (input: ProductSheetInput, attachLotIds: string[]) => Promise<ProductSheet>;
  updateSheet: (id: string, input: ProductSheetInput) => Promise<ProductSheet>;
  deleteSheet: (id: string) => Promise<void>;
  previewSheetRemoval: (id: string) => Promise<SheetRemoval>;
  archiveSheet: (id: string) => Promise<void>;
  restoreSheet: (id: string) => Promise<void>;
  previewLotRemoval: (id: string) => Promise<LotRemoval>;
  deleteLot: (id: string) => Promise<void>;
  archiveLot: (id: string) => Promise<void>;
  restoreLot: (id: string) => Promise<void>;
  /** Rattache un lot à une fiche, ou le détache (`null`). */
  setLotSheet: (lotId: string, sheetId: string | null) => Promise<LotSummary>;
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
  /** Annule un lien saisi par erreur (motif obligatoire). Le lien reste dans l'historique. */
  voidUsage: (usageId: string, reason: string) => Promise<SessionUsageItem>;
}

export const useProductsStore = create<ProductsState>((set, get) => ({
  categories: [],
  categoriesError: null,
  loadCategories: async () => {
    try {
      set({ categories: await invoke<Category[]>("list_categories"), categoriesError: null });
    } catch (error) {
      set({ categoriesError: String(error) });
    }
  },
  createCategory: async (input) => {
    const category = await invoke<Category>("create_category", { input });
    await get().loadCategories();
    return category;
  },
  updateCategory: async (id, input) => {
    const category = await invoke<Category>("update_category", { id, input });
    await Promise.all([get().loadCategories(), get().load()]);
    return category;
  },
  deleteCategory: async (id) => {
    await invoke("delete_category", { id });
    await Promise.all([get().loadCategories(), get().load()]);
  },
  setCategoryLowStock: async (id, setting) => {
    const category = await invoke<Category>("set_category_low_stock", { id, setting });
    await Promise.all([get().loadCategories(), get().load()]);
    return category;
  },
  lowStock: { sheets: [], categories: [] },
  lots: [],
  sheets: [],
  search: "",
  showArchived: false,
  loading: false,
  error: null,
  load: async (search = get().search, archived = get().showArchived) => {
    set({ loading: true, search, showArchived: archived });
    try {
      const [lots, sheets, lowStock] = await Promise.all([
        invoke<LotSummary[]>("list_lots", { search, archived }),
        invoke<ProductSheet[]>("list_product_sheets", { search, archived }),
        invoke<LowStockReport>("get_low_stock_report"),
      ]);
      set({ lots, sheets, lowStock, loading: false, error: null });
    } catch (error) {
      set({ loading: false, error: String(error) });
    }
  },
  listAllLots: () => invoke<LotSummary[]>("list_lots", { search: null, archived: null }),
  listAllSheets: () =>
    invoke<ProductSheet[]>("list_product_sheets", { search: null, archived: false }),
  getSheet: (id) => invoke<ProductSheet>("get_product_sheet", { id }),
  createSheet: async (input, attachLotIds) => {
    const sheet = await invoke<ProductSheet>("create_product_sheet", { input, attachLotIds });
    await Promise.all([get().load(), get().loadCategories()]);
    return sheet;
  },
  updateSheet: async (id, input) => {
    const sheet = await invoke<ProductSheet>("update_product_sheet", { id, input });
    await Promise.all([get().load(), get().loadCategories()]);
    return sheet;
  },
  deleteSheet: async (id) => {
    await invoke("delete_product_sheet", { id });
    await Promise.all([get().load(), get().loadCategories()]);
  },
  previewSheetRemoval: (id) => invoke<SheetRemoval>("preview_sheet_removal", { id }),
  archiveSheet: async (id) => {
    await invoke("archive_product_sheet", { id });
    await Promise.all([get().load(), get().loadCategories()]);
  },
  restoreSheet: async (id) => {
    await invoke("restore_product_sheet", { id });
    await Promise.all([get().load(), get().loadCategories()]);
  },
  previewLotRemoval: (id) => invoke<LotRemoval>("preview_lot_removal", { id }),
  deleteLot: async (id) => {
    await invoke("delete_lot", { id });
    await get().load();
  },
  archiveLot: async (id) => {
    await invoke("archive_lot", { id });
    await get().load();
  },
  restoreLot: async (id) => {
    await invoke("restore_lot", { id });
    await get().load();
  },
  setLotSheet: async (lotId, sheetId) => {
    const lot = await invoke<LotSummary>("set_lot_product_sheet", { lotId, sheetId });
    await Promise.all([get().load(), get().loadCategories()]);
    return lot;
  },
  get: (id) => invoke<LotSummary>("get_lot", { id }),
  find: (name, lotNumber) => invoke<LotSummary | null>("find_lot", { name, lotNumber }),
  create: async (input) => {
    const lot = await invoke<LotSummary>("create_lot", { input });
    await Promise.all([get().load(), get().loadCategories()]);
    return lot;
  },
  update: async (id, input) => {
    const lot = await invoke<LotSummary>("update_lot", { id, input });
    await Promise.all([get().load(), get().loadCategories()]);
    return lot;
  },
  listUnits: (lotId) => invoke<UnitView[]>("list_lot_units", { lotId }),
  openUnit: (unitId, openedAt) => invoke<UnitView>("open_unit", { unitId, openedAt }),
  exitUnit: (unitId, movementType) => invoke<UnitView>("exit_unit", { unitId, movementType }),
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
  voidUsage: (usageId, reason) =>
    invoke<SessionUsageItem>("void_session_usage", { input: { usageId, reason } }),
}));
