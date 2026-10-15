import type { ReactNode } from "react";

/** Cadre plein écran des écrans de sécurité (création, verrouillage). */
export function ScreenFrame({ children, wide = false }: { children: ReactNode; wide?: boolean }) {
  return (
    <div className="flex h-full min-h-0 overflow-auto bg-bg text-fg">
      <div className={`m-auto w-full ${wide ? "max-w-lg" : "max-w-md"} px-6 py-10`}>
        <p className="mb-6 text-center text-[13px] font-medium tracking-tight text-fg-muted">
          Tracink
        </p>
        <div className="rounded-lg border border-line bg-surface p-6">{children}</div>
      </div>
    </div>
  );
}
