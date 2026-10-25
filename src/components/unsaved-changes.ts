import { useCallback, useEffect, useState } from "react";
import { useUIStore } from "../stores/ui-store";
import { useConfirm } from "./use-confirm";

const dirtySources = new Map<number, boolean>();
let nextSource = 0;

function publishDirty(setUnsavedChanges: (value: boolean) => void) {
  setUnsavedChanges([...dirtySources.values()].some(Boolean));
}

/**
 * Déclare qu'un formulaire a des modifications non enregistrées.
 * Plusieurs formulaires sur le même écran se cumulent : le drapeau retombe
 * quand plus aucun n'est sale, ou quand le formulaire disparaît.
 */
export function useUnsavedChanges(dirty: boolean) {
  const setUnsavedChanges = useUIStore((state) => state.setUnsavedChanges);
  const [source] = useState(() => nextSource++);

  useEffect(() => {
    dirtySources.set(source, dirty);
    publishDirty(setUnsavedChanges);
    return () => {
      dirtySources.delete(source);
      publishDirty(setUnsavedChanges);
    };
  }, [dirty, setUnsavedChanges, source]);
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
