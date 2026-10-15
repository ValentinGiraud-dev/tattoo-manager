import { useEffect } from "react";
import { AppShell } from "./components/app-shell";
import { ConfirmProvider } from "./components/confirm-dialog";
import { UpdateNotice } from "./components/update-notice";
import ClientsPage from "./features/clients/clients-page";
import DashboardPage from "./features/dashboard/dashboard-page";
import PlanningPage from "./features/planning/planning-page";
import ProductsPage from "./features/products/products-page";
import SessionsPage from "./features/sessions/sessions-page";
import SettingsPage from "./features/settings/settings-page";
import { useSettingsStore } from "./stores/settings-store";
import { useUIStore } from "./stores/ui-store";

function App() {
  const { error, load } = useSettingsStore();
  const page = useUIStore((state) => state.page);

  useEffect(() => {
    void load();
  }, [load]);

  // Fournisseur propre à l'app : ses dialogues restent masqués avec elle quand l'app est verrouillée.
  return (
    <ConfirmProvider>
      <AppShell>
        <UpdateNotice />
        {error && (
          <div className="border-b border-line bg-surface px-8 py-3 text-[13px] text-danger">
            {error}
          </div>
        )}
        {page === "dashboard" && <DashboardPage />}
        {page === "planning" && <PlanningPage />}
        {page === "clients" && <ClientsPage />}
        {page === "sessions" && <SessionsPage />}
        {page === "products" && <ProductsPage />}
        {page === "settings" && <SettingsPage />}
      </AppShell>
    </ConfirmProvider>
  );
}

export default App;
