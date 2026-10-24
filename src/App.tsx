import { Fragment, useEffect } from "react";
import { AppShell } from "./components/app-shell";
import { ConfirmProvider } from "./components/confirm-dialog";
import { Toaster } from "./components/toaster";
import { UpdateNotice } from "./components/update-notice";
import ClientsPage from "./features/clients/clients-page";
import DashboardPage from "./features/dashboard/dashboard-page";
import PlanningPage from "./features/planning/planning-page";
import ProductsPage from "./features/products/products-page";
import ReportsPage from "./features/reports/reports-page";
import JournalPage from "./features/journal/journal-page";
import SessionsPage from "./features/sessions/sessions-page";
import SettingsPage from "./features/settings/settings-page";
import { DATA_RESET_NOTICE } from "./stores/security-store";
import { useSettingsStore } from "./stores/settings-store";
import { toast } from "./stores/toast-store";
import { useUIStore } from "./stores/ui-store";

function App() {
  const { error, load } = useSettingsStore();
  const page = useUIStore((state) => state.page);
  // Un clic dans le menu remonte l'écran : il repart de sa liste.
  const visit = useUIStore((state) => state.visit);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    try {
      if (sessionStorage.getItem(DATA_RESET_NOTICE) !== "1") return;
      sessionStorage.removeItem(DATA_RESET_NOTICE);
    } catch {
      return;
    }
    toast.success("Données réinitialisées");
  }, []);

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
        <Fragment key={`${page}-${visit}`}>
          {page === "dashboard" && <DashboardPage />}
          {page === "planning" && <PlanningPage />}
          {page === "clients" && <ClientsPage />}
          {page === "sessions" && <SessionsPage />}
          {page === "products" && <ProductsPage />}
          {page === "reports" && <ReportsPage />}
          {page === "journal" && <JournalPage />}
          {page === "settings" && <SettingsPage />}
        </Fragment>
      </AppShell>
      <Toaster />
    </ConfirmProvider>
  );
}

export default App;
