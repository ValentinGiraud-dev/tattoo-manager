import { useEffect, useRef, useState, type FormEvent } from "react";
import { btnGhost, btnPrimary, fieldClass, labelClass } from "../../components/styles";
import { errorMessage, useSecurityStore } from "../../stores/security-store";
import { NewPasswordFields } from "./password-fields";
import { EMPTY_PASSWORD, newPasswordProblem } from "./password-rules";
import { ScreenFrame } from "./screen-frame";

/** Touch ID annulé : Rust renvoie une erreur vide, rien à afficher. */
function visibleError(error: unknown): string | null {
  const message = errorMessage(error);
  return message.trim() === "" ? null : message;
}

function RecoveryForm({ onBack }: { onBack: () => void }) {
  const unlockWithRecoveryKey = useSecurityStore((state) => state.unlockWithRecoveryKey);
  const [recoveryKey, setRecoveryKey] = useState("");
  const [value, setValue] = useState(EMPTY_PASSWORD);
  const [showErrors, setShowErrors] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setShowErrors(true);
    const problem =
      recoveryKey.trim() === "" ? "Saisissez la clé de secours." : newPasswordProblem(value);
    if (problem) {
      setError(problem);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await unlockWithRecoveryKey(recoveryKey, value.password);
    } catch (unlockError) {
      setError(visibleError(unlockError));
      setBusy(false);
    }
  }

  return (
    <form onSubmit={(event) => void submit(event)} className="flex flex-col gap-4">
      <div>
        <h1 className="text-[18px] font-medium tracking-tight">Mot de passe oublié</h1>
        <p className="mt-1.5 text-[13px] text-fg-muted">
          Saisissez la clé de secours notée à la création, puis choisissez un nouveau mot de passe.
        </p>
      </div>
      <label className={labelClass}>
        Clé de secours
        <input
          value={recoveryKey}
          onChange={(event) => setRecoveryKey(event.target.value)}
          placeholder="XXXX-XXXX-XXXX-XXXX-XXXX-XXXX"
          autoComplete="off"
          autoFocus
          spellCheck={false}
          className={`${fieldClass} font-mono uppercase`}
        />
      </label>
      <NewPasswordFields value={value} onChange={setValue} showErrors={showErrors} />
      {error && (
        <p role="alert" className="text-[13px] text-danger">
          {error}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <button type="submit" disabled={busy} className={btnPrimary}>
          {busy ? "Ouverture…" : "Déverrouiller et changer le mot de passe"}
        </button>
        <button type="button" onClick={onBack} disabled={busy} className={btnGhost}>
          Retour
        </button>
      </div>
    </form>
  );
}

/**
 * Écran verrouillé. Au démarrage, Touch ID est proposé tout de suite s'il est
 * activé ; après un verrouillage, il se lance avec le bouton (ou Entrée).
 */
export function LockScreen({ autoTouchId }: { autoTouchId: boolean }) {
  const { status, unlockWithPassword, unlockWithTouchId } = useSecurityStore();
  const [mode, setMode] = useState<"password" | "recovery">("password");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState<"password" | "touchId" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const autoTried = useRef(false);
  const touchId = status?.touchIdEnabled === true;

  useEffect(() => {
    if (!autoTouchId || !touchId || autoTried.current) return;
    autoTried.current = true;
    unlockWithTouchId().catch((unlockError: unknown) => setError(visibleError(unlockError)));
  }, [autoTouchId, touchId, unlockWithTouchId]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (password === "") {
      setError("Saisissez le mot de passe.");
      return;
    }
    setBusy("password");
    setError(null);
    try {
      await unlockWithPassword(password);
    } catch (unlockError) {
      setError(visibleError(unlockError));
      setPassword("");
      setBusy(null);
    }
  }

  async function touch() {
    setBusy("touchId");
    setError(null);
    try {
      await unlockWithTouchId();
    } catch (unlockError) {
      setError(visibleError(unlockError));
      setBusy(null);
    }
  }

  if (mode === "recovery") {
    return (
      <ScreenFrame>
        <RecoveryForm onBack={() => setMode("password")} />
      </ScreenFrame>
    );
  }

  return (
    <ScreenFrame>
      <form onSubmit={(event) => void submit(event)} className="flex flex-col gap-4">
        <div>
          <h1 className="text-[18px] font-medium tracking-tight">Tracink est verrouillé</h1>
          <p className="mt-1.5 text-[13px] text-fg-muted">
            Les données de l’atelier sont chiffrées sur ce Mac.
          </p>
        </div>

        {status?.rotationPending && (
          <p
            role="note"
            className="rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-[13px] text-fg"
          >
            Le rechiffrement des données a été interrompu. Saisissez l’ancien ou le nouveau mot de
            passe : il se terminera à l’ouverture.
          </p>
        )}

        {touchId && (
          <button
            type="button"
            onClick={() => void touch()}
            disabled={busy !== null}
            className={`${btnPrimary} justify-center py-2`}
          >
            {busy === "touchId" ? "En attente de Touch ID…" : "Déverrouiller avec Touch ID"}
          </button>
        )}

        <label className={labelClass}>
          {touchId ? "Ou avec le mot de passe" : "Mot de passe"}
          <input
            type="password"
            autoComplete="current-password"
            autoFocus={!touchId}
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            className={fieldClass}
          />
        </label>

        {error && (
          <p role="alert" className="text-[13px] text-danger">
            {error}
          </p>
        )}

        <div className="flex flex-wrap items-center justify-between gap-2">
          <button
            type="submit"
            disabled={busy !== null}
            className={touchId ? btnGhost : btnPrimary}
          >
            {busy === "password" ? "Ouverture…" : "Déverrouiller"}
          </button>
          <button
            type="button"
            onClick={() => {
              setMode("recovery");
              setError(null);
            }}
            className="text-[12.5px] text-fg-muted underline-offset-2 hover:text-fg hover:underline"
          >
            Mot de passe oublié ?
          </button>
        </div>
      </form>
    </ScreenFrame>
  );
}
