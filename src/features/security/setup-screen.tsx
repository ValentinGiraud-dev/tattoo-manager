import { useState, type FormEvent } from "react";
import { btnGhost, btnPrimary } from "../../components/styles";
import { errorMessage, useSecurityStore } from "../../stores/security-store";
import { NewPasswordFields } from "./password-fields";
import { EMPTY_PASSWORD, newPasswordProblem } from "./password-rules";
import { RestorePanel } from "./restore-panel";
import { ScreenFrame } from "./screen-frame";

/** Premier lancement (ou première version chiffrée) : création du mot de passe. */
export function SetupScreen() {
  const { status, setup } = useSecurityStore();
  const [mode, setMode] = useState<"create" | "restore">(
    status?.vaultMissing ? "restore" : "create",
  );
  const [value, setValue] = useState(EMPTY_PASSWORD);
  const [showErrors, setShowErrors] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const converting = status?.hasPlaintextData === true;

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setShowErrors(true);
    const problem = newPasswordProblem(value);
    if (problem) {
      setError(problem);
      return;
    }
    setError(null);
    setSaving(true);
    try {
      await setup(value.password);
    } catch (setupError) {
      setError(errorMessage(setupError));
      setSaving(false);
    }
  }

  function restored() {
    // Rechargement complet : chaque écran repart des données restaurées.
    window.location.reload();
  }

  if (mode === "restore") {
    return (
      <ScreenFrame wide>
        {status?.vaultMissing && (
          <p
            role="alert"
            className="mb-4 rounded-md border border-danger/40 bg-danger/10 px-3 py-2 text-[13px] text-fg"
          >
            Le fichier des clés de Tracink a disparu : les données de ce Mac ne peuvent plus être
            ouvertes. Restaurez votre dernière sauvegarde.
          </p>
        )}
        <RestorePanel
          initialFolder={null}
          replacesData={converting || status?.vaultMissing === true}
          onRestored={restored}
          onCancel={status?.vaultMissing ? undefined : () => setMode("create")}
        />
      </ScreenFrame>
    );
  }

  return (
    <ScreenFrame>
      <form onSubmit={(event) => void submit(event)} className="flex flex-col gap-4">
        <div>
          <h1 className="text-[18px] font-medium tracking-tight">
            Protéger les données de l’atelier
          </h1>
          <p className="mt-1.5 text-[13px] text-fg-muted">
            Fiches clients, questionnaires de santé et scans signés sont chiffrés sur ce Mac.
            Tracink demandera ce mot de passe à l’ouverture et après quelques minutes d’inactivité.
            Touch ID pourra le remplacer au quotidien.
          </p>
        </div>

        {converting && (
          <p className="rounded-md border border-info/40 bg-info/10 px-3 py-2 text-[13px] text-fg">
            Vos données actuelles vont être chiffrées. Une copie de précaution est faite avant, et
            rien n’est supprimé tant que la copie chiffrée n’est pas vérifiée.
          </p>
        )}

        <NewPasswordFields
          value={value}
          onChange={setValue}
          showErrors={showErrors}
          autoFocus
          label="Mot de passe de Tracink"
        />

        {error && (
          <p role="alert" className="text-[13px] text-danger">
            {error}
          </p>
        )}

        <div className="flex flex-wrap items-center gap-2">
          <button type="submit" disabled={saving} className={btnPrimary}>
            {saving
              ? converting
                ? "Chiffrement des données…"
                : "Création…"
              : "Protéger mes données"}
          </button>
          {!converting && (
            <button
              type="button"
              onClick={() => setMode("restore")}
              disabled={saving}
              className={btnGhost}
            >
              Restaurer une sauvegarde
            </button>
          )}
        </div>
      </form>
    </ScreenFrame>
  );
}
