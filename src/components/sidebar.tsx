import { useUIStore, type AppPage } from "../stores/ui-store";

const NAV: { id: AppPage; label: string }[] = [
  { id: "dashboard", label: "Dashboard" },
  { id: "clients", label: "Clients" },
  { id: "sessions", label: "Séances" },
  { id: "products", label: "Produits" },
];

export function Sidebar() {
  const { page, setPage } = useUIStore();

  return (
    <aside className="flex w-[210px] shrink-0 flex-col border-r border-line bg-surface">
      <div className="border-b border-line px-4 py-4">
        <p className="text-[13px] font-medium tracking-tight text-fg">Tattoo Manager</p>
        <p className="mt-0.5 text-[11px] text-fg-faint">Atelier</p>
      </div>
      <nav className="flex flex-col gap-0.5 p-3" aria-label="Navigation principale">
        <span className="px-2 pb-1 pt-2 text-[11px] font-medium tracking-[0.06em] text-fg-faint uppercase">
          Menu
        </span>
        {NAV.map((item) => {
          const active = page === item.id;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => setPage(item.id)}
              aria-current={active ? "page" : undefined}
              className={[
                "rounded-sm px-2 py-1.5 text-left text-[13px] transition-colors",
                active
                  ? "bg-surface-3 font-medium text-fg"
                  : "text-fg-muted hover:bg-surface-2 hover:text-fg",
              ].join(" ")}
            >
              {item.label}
            </button>
          );
        })}
      </nav>
    </aside>
  );
}
