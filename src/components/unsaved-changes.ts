import { useCallback, useEffect } from "react";
import { useUIStore } from "../stores/ui-store";
import { useConfirm } from "./use-confirm";

/**
 * Déclare qu'un formulaire a des modifications non enregistrées.
 * Le drapeau est levé automatiquement quand le formulaire disparaît.
 */
export function useUnsavedChanges(dirty: boolean) {
  const setUnsavedChanges = useUIStore((state) => state.setUnsavedChanges);

  useEffect(() => {
    setUnsavedChanges(dirty);
  }, [dirty, setUnsavedChanges]);

  useEffect(() => () => setUnsavedChanges(false), [setUnsavedChanges]);
}

/**
 * Renvoie une fonction qui exécute `leave` après confirmation
 * si des modifications ne sont pas enregistrées.
 */
export function useGuardedLeave() {
  const confirm = useConfirm();

  return useCallback(
    async (leave: () => void) => {
      const { unsavedChanges, setUnsavedChanges } = useUIStore.getState();
      if (unsavedChanges) {
        const ok = await confirm({
          title: "Abandonner les modifications ?",
          body: "Ce que tu as saisi dans ce formulaire ne sera pas enregistré.",
          confirmLabel: "Abandonner",
          cancelLabel: "Continuer la saisie",
          tone: "danger",
        });
        if (!ok) return;
        setUnsavedChanges(false);
      }
      leave();
    },
    [confirm],
  );
}
