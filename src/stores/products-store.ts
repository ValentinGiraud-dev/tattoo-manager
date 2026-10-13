import { invoke } from "@tauri-apps/api/core";
import { create } from "zustand";

export interface Product {
  id: string;
  name: string;
  lotNumber: string;
  creationDate: string | null;
  openedAt: string | null;
  expirationDate: string;
  afterOpeningMonths: number | null;
  singleUse: boolean;
  productUrl: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ProductInput {
  name: string;
  lotNumber: string;
  creationDate: string | null;
  openedAt: string | null;
  expirationDate: string;
  afterOpeningMonths: number | null;
  singleUse: boolean;
  productUrl: string | null;
}

export interface SessionProductItem {
  sessionId: string;
  productId: string;
  createdAt: string;
  name: string;
  lotNumber: string;
  expirationDate: string;
  singleUse: boolean;
}

export interface ProductSessionItem {
  sessionId: string;
  productId: string;
  createdAt: string;
  date: string;
  status: string;
  bodyArea: string | null;
  clientFirstName: string;
  clientLastName: string;
}

interface ProductsState {
  products: Product[];
  search: string;
  loading: boolean;
  error: string | null;
  load: (search?: string) => Promise<void>;
  create: (input: ProductInput) => Promise<Product>;
  update: (id: string, input: ProductInput) => Promise<Product>;
  listSessions: (productId: string) => Promise<ProductSessionItem[]>;
  listSessionProducts: (sessionId: string) => Promise<SessionProductItem[]>;
  listLinkable: (sessionId: string, search?: string) => Promise<Product[]>;
  linkToSession: (sessionId: string, productId: string) => Promise<SessionProductItem>;
}

export const useProductsStore = create<ProductsState>((set, get) => ({
  products: [],
  search: "",
  loading: false,
  error: null,
  load: async (search = get().search) => {
    set({ loading: true, search });
    try {
      const products = await invoke<Product[]>("list_products", { search });
      set({ products, loading: false, error: null });
    } catch (error) {
      set({ loading: false, error: String(error) });
    }
  },
  create: async (input) => {
    const product = await invoke<Product>("create_product", { input });
    await get().load();
    return product;
  },
  update: async (id, input) => {
    const product = await invoke<Product>("update_product", { id, input });
    await get().load();
    return product;
  },
  listSessions: (productId) =>
    invoke<ProductSessionItem[]>("list_product_sessions", { productId }),
  listSessionProducts: (sessionId) =>
    invoke<SessionProductItem[]>("list_session_products", { sessionId }),
  listLinkable: (sessionId, search) =>
    invoke<Product[]>("list_linkable_products", { sessionId, search }),
  linkToSession: (sessionId, productId) =>
    invoke<SessionProductItem>("link_session_product", { sessionId, productId }),
}));
