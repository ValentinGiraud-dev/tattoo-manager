import { PAGE_LABELS, useUIStore } from "../stores/ui-store";
import { useGuardedLeave } from "./unsaved-changes";

/**
 * Retour d'une fiche. Ouverte depuis un autre écran (accueil, séance…), elle y
 * ramène ; sinon elle revient à la liste de l'écran.
 */
export function BackButton({ listLabel, onList }: { listLabel: string; onList: () => void }) {
  const origin = useUIStore((state) => state.origin);
  const goBack = useUIStore((state) => state.goBack);
  const guardedLeave = useGuardedLeave();
  return (
    <button
      type="button"
      onClick={() => (origin ? void guardedLeave(goBack) : onList())}
      className="self-start text-[13px] text-fg-muted hover:text-fg"
    >
      ← {origin ? PAGE_LABELS[origin.page] : listLabel}
    </button>
  );
}
