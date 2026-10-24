import { useState, type FormEvent } from "react";
import { btnGhost, cardClass, fieldClass, labelClass } from "../../components/styles";
import { useUnsavedChanges } from "../../components/unsaved-changes";
import { useConfirm } from "../../components/use-confirm";
import { errorMessage, useSecurityStore, type ResetScope } from "../../stores/security-store";

const btnDanger =
  "inline-flex items-center justify-center rounded-pill bg-danger px-3.5 py-1.5 text-[13px] font-medium text-bg transition-[filter] hover:brightness-110 disabled:opacity-45";

type Busy = "data-password" | "data-touch" | "install-password" | "install-touch";

/** Touch ID annulé : Rust renvoie une erreur vide, rien à afficher. */
function visibleError(error: unknown): string | null {
  const message = errorMessage(error);
  return message.trim() === "" ? null : message;
}

/**
 * Deux effacements sur ce Mac : les données métier, ou toute l'installation.
 */
export function DangerZone({ touchIdEnabled }: { touchIdEnabled: boolean }) {
  const resetApp = useSecurityStore((state) => state.resetApp);
  const confirm = useConfirm();
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState<Busy | null>(null);
  const [error, setError] = useState<string | null>(null);
  useUnsavedChanges(password !== "" || busy !== null);

  async function confirmed(scope: ResetScope) {
    if (scope === "installation") {
      return confirm({
        title: "Réinitialiser Tracink ?",
        details: [
          "Mot de passe, clé de secours et Touch ID",
          "Réglages de l’atelier",
          "Clients, séances, projets, stock, documents et photos",
          "Copies automatiques de ce Mac",
        ],
        body: "Tracink revient à l’écran de création du mot de passe.",
        warning:
          "Les sauvegardes externes déjà faites restent dans le dossier choisi. Les restaurer ramènerait l’ancien mot de passe et ces données.",
        confirmLabel: "Réinitialiser Tracink",
        cancelLabel: "Annuler",
        tone: "danger",
        typeToConfirm: "EFFACER",
      });
    }
    return confirm({
      title: "Réinitialiser les données ?",
      details: [
        "Clients, séances, projets, stock, documents et photos",
        "Copies automatiques de ce Mac",
      ],
      body: "Le mot de passe, Touch ID et les réglages de l’atelier restent. L’app se rouvre vide.",
      warning:
        "Les sauvegardes externes déjà faites restent dans le dossier choisi. Les restaurer ramènerait ces données.",
      confirmLabel: "Réinitialiser les données",
      cancelLabel: "Annuler",
      tone: "danger",
      typeToConfirm: "RÉINITIALISER",
    });
  }

  async function withPassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await runPassword("data");
  }

  async function runPassword(scope: ResetScope) {
    if (password === "") {
      setError("Saisissez le mot de passe.");
      return;
    }
    setError(null);
    const ok = await confirmed(scope);
    if (!ok) return;
    setBusy(scope === "installation" ? "install-password" : "data-password");
    try {
      await resetApp({ method: "password", password, scope });
    } catch (resetError) {
      setError(visibleError(resetError));
      setBusy(null);
    }
  }

  async function withTouchId(scope: ResetScope) {
    setError(null);
    const ok = await confirmed(scope);
    if (!ok) return;
    setBusy(scope === "installation" ? "install-touch" : "data-touch");
    try {
      await resetApp({ method: "touchId", scope });
    } catch (resetError) {
      setError(visibleError(resetError));
      setBusy(null);
    }
  }

  return (
    <section className={`${cardClass} flex flex-col gap-4 border-danger/40 p-4`}>
      <h2 className="text-[14px] font-medium text-danger">Zone dangereuse</h2>
      <form onSubmit={(event) => void withPassword(event)} className="flex flex-col gap-4">
        <label className={labelClass}>
          Mot de passe Tracink
          <input
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            disabled={busy !== null}
            className={fieldClass}
          />
        </label>
        {error && (
          <p role="alert" className="text-[13px] text-danger">
            {error}
          </p>
        )}
        <div className="flex flex-col gap-2 border-t border-line pt-3">
          <h3 className="text-[13px] font-medium">Réinitialiser les données</h3>
          <p className="text-[12.5px] text-fg-muted">
            Efface les clients, les séances, les projets, le stock, les documents et les photos de
            ce Mac, ainsi que les copies automatiques. Le mot de passe, Touch ID et les réglages de
            l’atelier restent. Les sauvegardes déjà faites dans le dossier que tu as choisi restent
            aussi : les restaurer ramènerait ces données.
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <button type="submit" disabled={busy !== null} className={btnDanger}>
              {busy === "data-password" ? "Réinitialisation…" : "Réinitialiser les données"}
            </button>
            {touchIdEnabled && (
              <button
                type="button"
                onClick={() => void withTouchId("data")}
                disabled={busy !== null}
                className={btnGhost}
              >
                {busy === "data-touch" ? "En attente de Touch ID…" : "Réinitialiser avec Touch ID"}
              </button>
            )}
          </div>
        </div>
        <div className="flex flex-col gap-2 border-t border-line pt-3">
          <h3 className="text-[13px] font-medium">Réinitialiser Tracink</h3>
          <p className="text-[12.5px] text-fg-muted">
            Efface aussi le mot de passe, la clé de secours, Touch ID et les réglages de l’atelier.
            Tracink revient à l’écran de création du mot de passe. Les sauvegardes déjà faites dans
            le dossier que tu as choisi restent : les restaurer ramènerait l’ancien mot de passe et
            ces données.
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => void runPassword("installation")}
              disabled={busy !== null}
              className={btnDanger}
            >
              {busy === "install-password" ? "Réinitialisation…" : "Réinitialiser Tracink"}
            </button>
            {touchIdEnabled && (
              <button
                type="button"
                onClick={() => void withTouchId("installation")}
                disabled={busy !== null}
                className={btnGhost}
              >
                {busy === "install-touch"
                  ? "En attente de Touch ID…"
                  : "Réinitialiser Tracink avec Touch ID"}
              </button>
            )}
          </div>
        </div>
      </form>
    </section>
  );
}
