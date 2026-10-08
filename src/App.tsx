import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useSettingsStore } from "./stores/settings-store";

function App() {
  const { settings, paths, loaded, error, load } = useSettingsStore();
  const [migrationCount, setMigrationCount] = useState<number | null>(null);

  useEffect(() => {
    void load();
    invoke<number>("database_status")
      .then(setMigrationCount)
      .catch((statusError: unknown) => {
        console.error(statusError);
      });
  }, [load]);

  return (
    <main className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
      <h1 className="text-3xl font-semibold">Tattoo Manager</h1>

      {!loaded && <p className="text-neutral-600">Chargement de la configuration…</p>}

      {error && <p className="text-red-600">{error}</p>}

      {loaded && !error && settings && paths && (
        <>
          <p className="text-neutral-600">
            Locale {settings.locale} · fenêtre {settings.window.width}×{settings.window.height}
          </p>
          <p className="max-w-xl break-all text-sm text-neutral-500">{paths.root}</p>
          {migrationCount !== null && (
            <p className="text-sm text-neutral-500">
              {migrationCount} migration{migrationCount > 1 ? "s" : ""} appliquée
              {migrationCount > 1 ? "s" : ""}
            </p>
          )}
        </>
      )}
    </main>
  );
}

export default App;
