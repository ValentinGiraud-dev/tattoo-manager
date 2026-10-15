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
  /** Demande de choisir une option (boutons radio) avant de valider. */
  choices?: { value: string; label: string; description?: string }[];
  /** Option présélectionnée. Sans valeur, le choix est obligatoire. */
  defaultChoice?: string;
  /**
   * Confirmation renforcée : ce mot doit être recopié pour activer le bouton
   * (restaurer une sauvegarde, remplacer des données en masse).
   */
  typeToConfirm?: string;
};

export type ConfirmResult = { reason: string | null; choice: string | null };

export type ConfirmRequest = ConfirmOptions & { resolve: (result: ConfirmResult | null) => void };

export type ConfirmFn = (options: ConfirmOptions) => Promise<ConfirmResult | null>;

export const ConfirmContext = createContext<ConfirmFn | null>(null);

/**
 * Demande une confirmation. Renvoie `null` si l'utilisatrice renonce,
 * sinon `{ reason, choice }` (motif saisi et option choisie, `null` s'ils ne sont pas demandés).
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
