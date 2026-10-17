import { create } from "zustand";

export type ToastTone = "success" | "info";

export type Toast = { id: number; message: string; tone: ToastTone };

/** Durée d'affichage d'un toast, en millisecondes. */
export const TOAST_MS = 3500;
const MAX_TOASTS = 3;

type ToastState = {
  toasts: Toast[];
  push: (message: string, tone?: ToastTone) => void;
  dismiss: (id: number) => void;
};

let nextId = 1;

export const useToastStore = create<ToastState>((set) => ({
  toasts: [],
  push: (message, tone = "success") => {
    const id = nextId++;
    set((state) => ({ toasts: [...state.toasts, { id, message, tone }].slice(-MAX_TOASTS) }));
  },
  dismiss: (id) => set((state) => ({ toasts: state.toasts.filter((toast) => toast.id !== id) })),
}));

/**
 * Confirme une écriture réussie : « Client enregistré », « Paiement enregistré ».
 * Les erreurs restent affichées dans l'écran, près du formulaire, jamais en toast.
 */
export const toast = {
  success: (message: string) => useToastStore.getState().push(message, "success"),
  info: (message: string) => useToastStore.getState().push(message, "info"),
};
