import { useEffect } from "react";
import { TOAST_MS, useToastStore, type Toast } from "../stores/toast-store";

function ToastItem({ toast }: { toast: Toast }) {
  const dismiss = useToastStore((state) => state.dismiss);

  useEffect(() => {
    const timer = window.setTimeout(() => dismiss(toast.id), TOAST_MS);
    return () => window.clearTimeout(timer);
  }, [toast.id, dismiss]);

  return (
    <li className="pointer-events-auto flex items-center gap-3 rounded-md border border-line-strong bg-surface-2 px-3.5 py-2.5 text-[13px] text-fg shadow-xl motion-safe:animate-[toast-in_var(--t-base)_var(--ease-out)]">
      <span
        aria-hidden="true"
        className={`size-2 shrink-0 rounded-full ${toast.tone === "success" ? "bg-success" : "bg-info"}`}
      />
      <span className="min-w-0 flex-1">{toast.message}</span>
      <button
        type="button"
        onClick={() => dismiss(toast.id)}
        aria-label="Fermer"
        className="-mr-1 rounded-sm px-1 text-fg-faint transition-colors hover:text-fg"
      >
        ×
      </button>
    </li>
  );
}

/** Zone des toasts, en bas à droite. Annoncée aux lecteurs d'écran sans voler le focus. */
export function Toaster() {
  const toasts = useToastStore((state) => state.toasts);
  return (
    <ol
      aria-live="polite"
      aria-label="Notifications"
      className="pointer-events-none fixed right-5 bottom-5 z-40 flex w-80 flex-col gap-2"
    >
      {toasts.map((toast) => (
        <ToastItem key={toast.id} toast={toast} />
      ))}
    </ol>
  );
}
