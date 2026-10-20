import { useState, type FormEvent } from "react";
import { btnGhost, btnPrimary, cardClass, fieldClass, labelClass } from "../../components/styles";
import { useUnsavedChanges } from "../../components/unsaved-changes";
import { useConfirm } from "../../components/use-confirm";
import { NewPasswordFields } from "../security/password-fields";
import { EMPTY_PASSWORD, newPasswordProblem } from "../security/password-rules";
import { RecoveryKeyPanel } from "../security/recovery-key-panel";
import { KeyRotation } from "./key-rotation";
import {
  AUTO_LOCK_CHOICES,
  errorMessage,
  useSecurityStore,
  type SecurityStatus,
} from "../../stores/security-store";

function autoLockLabel(minutes: number): string {
  return minutes === 0 ? "Jamais" : `Après ${minutes} minutes sans activité`;
}

function ChangePasswordForm() {
  const changePassword = useSecurityStore((state) => state.changePassword);
  const [current, setCurrent] = useState("");
  const [value, setValue] = useState(EMPTY_PASSWORD);
  const [showErrors, setShowErrors] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dirty = current !== "" || value.password !== "" || value.confirmation !== "";
  useUnsavedChanges(dirty);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setShowErrors(true);
    setSaved(false);
    const problem =
      current === "" ? "Saisissez le mot de passe actuel." : newPasswordProblem(value);
    if (problem) {
      setError(problem);
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await changePassword(current, value.password);
      setCurrent("");
      setValue(EMPTY_PASSWORD);
      setShowErrors(false);
      setSaved(true);
    } catch (saveError) {
      setError(errorMessage(saveError));
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={(event) => void submit(event)} className="flex flex-col gap-3">
      <h3 className="text-[13px] font-medium">Changer le mot de passe</h3>
      <label className={labelClass}>
        Mot de passe actuel
        <input
          type="password"
          autoComplete="current-password"
          value={current}
          onChange={(event) => {
            setCurrent(event.target.value);
            setSaved(false);
          }}
          className={fieldClass}
        />
      </label>
      <NewPasswordFields
        value={value}
        onChange={(next) => {
          setValue(next);
          setSaved(false);
        }}
        showErrors={showErrors}
      />
      {error && (
        <p role="alert" className="text-[13px] text-danger">
          {error}
        </p>
      )}
      <div className="flex items-center gap-3">
        <button type="submit" disabled={saving || !dirty} className={btnPrimary}>
          {saving ? "Enregistrement…" : "Changer le mot de passe"}
        </button>
        {saved && (
          <span role="status" className="text-[13px] text-success">
            Mot de passe changé
          </span>
        )}
      </div>
      <p className="text-[12px] text-fg-faint">
        Les sauvegardes déjà faites s’ouvrent avec le mot de passe en vigueur à leur date, ou avec
        la clé de secours.
      </p>
    </form>
  );
}

function RecoveryKeyRenewal() {
  const renewRecoveryKey = useSecurityStore((state) => state.renewRecoveryKey);
  const confirm = useConfirm();
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [newKey, setNewKey] = useState<string | null>(null);
  useUnsavedChanges(newKey !== null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (password === "") {
      setError("Saisissez le mot de passe.");
      return;
    }
    const ok = await confirm({
      title: "Remplacer la clé de secours ?",
      body: "Une nouvelle clé est créée et l’ancienne ne fonctionnera plus sur ce Mac ni pour les prochaines sauvegardes.",
      warning:
        "Les sauvegardes déjà faites restent liées à l’ancienne clé : gardez-la tant qu’elles existent (30 sauvegardes environ).",
      confirmLabel: "Créer une nouvelle clé",
      tone: "danger",
    });
    if (!ok) return;
    setBusy(true);
    setError(null);
    try {
      setNewKey(await renewRecoveryKey(password));
      setPassword("");
    } catch (renewError) {
      setError(errorMessage(renewError));
    } finally {
      setBusy(false);
    }
  }

  if (newKey) {
    return (
      <RecoveryKeyPanel
        recoveryKey={newKey}
        doneLabel="Terminé"
        onDone={() => {
          setNewKey(null);
          setOpen(false);
        }}
      />
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <h3 className="text-[13px] font-medium">Clé de secours</h3>
      <p className="text-[12.5px] text-fg-muted">
        Elle remplace le mot de passe s’il est oublié. Créez-en une nouvelle si elle est perdue ou
        si quelqu’un d’autre a pu la voir.
      </p>
      {open ? (
        <form onSubmit={(event) => void submit(event)} className="flex flex-col gap-3">
          <label className={labelClass}>
            Mot de passe de Tracink
            <input
              type="password"
              autoComplete="current-password"
              autoFocus
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
          <div className="flex gap-2">
            <button type="submit" disabled={busy} className={btnPrimary}>
              {busy ? "Création…" : "Créer une nouvelle clé…"}
            </button>
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                setPassword("");
                setError(null);
              }}
              className={btnGhost}
            >
              Annuler
            </button>
          </div>
        </form>
      ) : (
        <div>
          <button type="button" onClick={() => setOpen(true)} className={btnGhost}>
            Créer une nouvelle clé de secours…
          </button>
        </div>
      )}
    </div>
  );
}

export function SecuritySection({ status }: { status: SecurityStatus }) {
  const { setAutoLock, setTouchId, lock } = useSecurityStore();
  const [error, setError] = useState<string | null>(null);
  const [touchBusy, setTouchBusy] = useState(false);

  async function changeAutoLock(minutes: number) {
    setError(null);
    try {
      await setAutoLock(minutes);
    } catch (saveError) {
      setError(errorMessage(saveError));
    }
  }

  async function toggleTouchId(enabled: boolean) {
    setError(null);
    setTouchBusy(true);
    try {
      await setTouchId(enabled);
    } catch (saveError) {
      setError(errorMessage(saveError));
    } finally {
      setTouchBusy(false);
    }
  }

  return (
    <section className={`${cardClass} flex flex-col gap-5 p-4`}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-[14px] font-medium">Sécurité</h2>
          <p className="mt-0.5 text-[12.5px] text-fg-muted">
            Base et documents sont chiffrés sur ce Mac (AES-256).
          </p>
        </div>
        <button
          type="button"
          onClick={() => void lock()}
          className={`${btnGhost} shrink-0 whitespace-nowrap`}
        >
          Verrouiller maintenant
        </button>
      </div>

      <label className={labelClass}>
        Verrouillage automatique
        <select
          value={status.autoLockMinutes}
          onChange={(event) => void changeAutoLock(Number(event.target.value))}
          className={fieldClass}
        >
          {AUTO_LOCK_CHOICES.map((minutes) => (
            <option key={minutes} value={minutes}>
              {autoLockLabel(minutes)}
            </option>
          ))}
        </select>
      </label>

      <div>
        {status.touchIdAvailable ? (
          <label className="flex items-start gap-2.5 text-[13.5px] text-fg">
            <input
              type="checkbox"
              checked={status.touchIdEnabled}
              disabled={touchBusy}
              onChange={(event) => void toggleTouchId(event.target.checked)}
              className="mt-1 accent-[var(--accent)]"
            />
            <span>
              Déverrouiller avec Touch ID
              <span className="mt-0.5 block text-[12.5px] text-fg-muted">
                {touchBusy ? "En attente de Touch ID…" : "Le mot de passe reste toujours accepté."}
              </span>
            </span>
          </label>
        ) : (
          <p className="text-[12.5px] text-fg-muted">
            Touch ID n’est pas disponible sur ce Mac (pas de capteur ou aucune empreinte
            enregistrée).
          </p>
        )}
      </div>

      {error && (
        <p role="alert" className="text-[13px] text-danger">
          {error}
        </p>
      )}

      <hr className="border-line" />
      <ChangePasswordForm />
      <hr className="border-line" />
      <RecoveryKeyRenewal />
      <hr className="border-line" />
      <KeyRotation />
    </section>
  );
}
