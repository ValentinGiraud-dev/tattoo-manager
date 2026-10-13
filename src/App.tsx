import { useEffect } from "react";
import { AppShell } from "./components/app-shell";
import ClientsPage from "./features/clients/clients-page";
import DashboardPage from "./features/dashboard/dashboard-page";
import ProductsPage from "./features/products/products-page";
import SessionsPage from "./features/sessions/sessions-page";
import { useSettingsStore } from "./stores/settings-store";
import { useUIStore } from "./stores/ui-store";

function App() {
  const { error, load } = useSettingsStore();
  const page = useUIStore((state) => state.page);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <AppShell>
      {error && (
        <div className="border-b border-line bg-surface px-8 py-3 text-[13px] text-danger">
          {error}
        </div>
      )}
      {page === "dashboard" && <DashboardPage />}
      {page === "clients" && <ClientsPage />}
      {page === "sessions" && <SessionsPage />}
      {page === "products" && <ProductsPage />}
    </AppShell>
  );
}

export default App;
