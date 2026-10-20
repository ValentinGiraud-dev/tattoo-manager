import type { ReactNode } from "react";

/** En-tête d'un formulaire de Produits : retour et titre. */
export function FormHeader({ title, onBack }: { title: string; onBack: () => void }) {
  return (
    <div>
      <button
        type="button"
        onClick={onBack}
        className="mb-4 text-[13px] text-fg-muted hover:text-fg"
      >
        ← Retour
      </button>
      <h1 className="text-[24px] font-medium tracking-tight">{title}</h1>
    </div>
  );
}

/** Information neutre au-dessus des champs. */
export function Notice({ children }: { children: ReactNode }) {
  return (
    <p className="rounded-md border border-line bg-surface px-3 py-2 text-[13px] text-fg-muted">
      {children}
    </p>
  );
}
