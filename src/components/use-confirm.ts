import { createContext, useContext, type ReactNode } from "react";

export type ConfirmTone = "default" | "danger";

export type ConfirmOptions = {
  /** Question avec le verbe : « Sortir cette pièce du stock ? » */
  title: string;
  /** Ce qui va se passer, avec les vrais noms. */
  body?: ReactNode;
  /** Lignes de récapitulatif (produit, lot, quantité…). */
  details?: string[];
  /** Avertissement métier mis en évidence (lot périmé, etc.). */
  warning?: string;
  /** Verbe exact de l'action. Jamais « OK » ni « Oui ». */
  confirmLabel: string;
  /** Libellé du bouton qui renonce. « Annuler » par défaut. */
  cancelLabel?: string;
  tone?: ConfirmTone;
  /** Demande un motif avant de valider. */
  reason?: { label: string; required?: boolean; placeholder?: string };
};

export type ConfirmResult = { reason: string | null };

export type ConfirmRequest = ConfirmOptions & { resolve: (result: ConfirmResult | null) => void };

export type ConfirmFn = (options: ConfirmOptions) => Promise<ConfirmResult | null>;

export const ConfirmContext = createContext<ConfirmFn | null>(null);

/**
 * Demande une confirmation. Renvoie `null` si l'utilisatrice renonce,
 * sinon `{ reason }` (le motif saisi, ou `null` sans champ motif).
 *
 * ```ts
 * const ok = await confirm({ title: "…", confirmLabel: "Sortir la pièce", tone: "danger" });
 * if (!ok) return;
 * ```
 */
export function useConfirm(): ConfirmFn {
  const confirm = useContext(ConfirmContext);
  if (!confirm) {
    throw new Error("useConfirm doit être utilisé sous <ConfirmProvider>");
  }
  return confirm;
}
