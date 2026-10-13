import type { ReactNode } from "react";
import { Sidebar } from "./sidebar";

export function AppShell({ children }: { children: ReactNode }) {
  return (
    <div className="flex h-full min-h-0 overflow-hidden bg-bg text-fg">
      <Sidebar />
      <main className="min-w-0 flex-1 overflow-auto">{children}</main>
    </div>
  );
}
