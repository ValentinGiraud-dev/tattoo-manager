import type { LotSummary } from "../../stores/products-store";

export const emptyToNull = (value: string) => (value.trim() === "" ? null : value.trim());

export const MOVEMENT_LABELS: Record<string, string> = {
  PURCHASE: "Réception",
  CONSUMPTION: "Consommation",
  LOSS: "Perte",
  EXPIRATION: "Péremption",
  RETURN: "Retour",
  ADJUSTMENT: "Ajustement",
};

export const MOVEMENT_ARTICLE: Record<string, string> = {
  LOSS: "cette perte",
  EXPIRATION: "cette péremption",
  RETURN: "ce retour",
  ADJUSTMENT: "cet ajustement",
};

export const EXIT_ACTIONS: Record<string, { title: string; label: string; body: string }> = {
  CONSUMPTION: {
    title: "Marquer cette pièce comme terminée ?",
    label: "Marquer terminée",
    body: "La pièce sort du stock et ne sera plus proposée dans les séances.",
  },
  LOSS: {
    title: "Déclarer cette pièce perdue ?",
    label: "Déclarer perdue",
    body: "La pièce sort du stock et ne sera plus proposée dans les séances.",
  },
  EXPIRATION: {
    title: "Sortir cette pièce comme périmée ?",
    label: "Sortir comme périmée",
    body: "La pièce sort du stock et ne sera plus proposée dans les séances.",
  },
  RETURN: {
    title: "Renvoyer cette pièce ?",
    label: "Renvoyer la pièce",
    body: "La pièce sort du stock (retour fournisseur) et ne sera plus proposée dans les séances.",
  },
};

export const EXIT_LABELS: Record<string, string> = {
  CONSUMPTION: "Terminé",
  LOSS: "Perdu",
  EXPIRATION: "Périmé",
  RETURN: "Renvoyé",
};

export function stockLabel(lot: LotSummary): string {
  if (lot.singleUse) {
    if (lot.movementCount === 0) return "Stock non renseigné";
    return `${lot.stock} restant${lot.stock > 1 ? "s" : ""}`;
  }
  const sealed = `${lot.sealedCount} scellé${lot.sealedCount > 1 ? "s" : ""}`;
  const opened = `${lot.openedCount} ouvert${lot.openedCount > 1 ? "s" : ""}`;
  return `${lot.stock} en stock · ${sealed} · ${opened}`;
}
