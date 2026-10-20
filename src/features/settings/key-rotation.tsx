import { useState, type FormEvent } from "react";
import { btnGhost, btnPrimary, fieldClass, labelClass } from "../../components/styles";
import { useUnsavedChanges } from "../../components/unsaved-changes";
import { useConfirm } from "../../components/use-confirm";
import { errorMessage, useSecurityStore } from "../../stores/security-store";
import { toast } from "../../stores/toast-store";
import { NewPasswordFields } from "../security/password-fields";
import { EMPTY_PASSWORD, newPasswordProblem } from "../security/password-rules";
import { RecoveryKeyPanel } from "../security/recovery-key-panel";

/**
 * Rotation de la clé maître : tout est rechiffré sous une nouvelle clé, avec un
 * nouveau mot de passe et une nouvelle clé de secours.
 */
export function KeyRotation() {
  const rotateKey = useSecurityStore((state) => state.rotateKey);
  const confirm = useConfirm();
  const [open, setOpen] = useState(false);
  const [current, setCurrent] = useState("");
  const [value, setValue] = useState(EMPTY_PASSWORD);
  const [showErrors, setShowErrors] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [newKey, setNewKey] = useState<string | null>(null);
  const dirty = current !== "" || value.password !== "" || value.confirmation !== "";
  useUnsavedChanges(newKey !== null || dirty || busy);

  function close() {
    setOpen(false);
    setCurrent("");
    setValue(EMPTY_PASSWORD);
    setShowErrors(false);
    setError(null);
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setShowErrors(true);
    const problem =
      current === ""
        ? "Saisissez le mot de passe actuel."
        : (newPasswordProblem(value) ??
          (value.password === current
            ? "Choisissez un mot de passe différent de l’actuel."
            : null));
    if (problem) {
      setError(problem);
      return;
    }
    const ok = await confirm({
      title: "Rechiffrer toutes les données ?",
      details: [
        "Base de données, documents signés, photos et copies automatiques",
        "Nouveau mot de passe et nouvelle clé de secours",
      ],
      body: "Une nouvelle clé de chiffrement remplace l’actuelle. L’ancien mot de passe et l’ancienne clé de secours n’ouvriront plus les données de ce Mac. Si Tracink est fermé pendant l’opération, elle se termine à l’ouverture suivante.",
      warning:
        "Les sauvegardes externes déjà faites ne sont pas modifiées : elles s’ouvrent toujours avec l’ancien mot de passe ou l’ancienne clé de secours. Si elles ont pu fuiter, supprimez-les une fois la nouvelle sauvegarde faite.",
      confirmLabel: "Rechiffrer les données",
      tone: "danger",
      typeToConfirm: "RECHIFFRER",
    });
    if (!ok) return;
    setBusy(true);
    setError(null);
    try {
      const recoveryKey = await rotateKey(current, value.password);
      close();
      setNewKey(recoveryKey);
      toast.success("Données rechiffrées avec une nouvelle clé");
    } catch (rotateError) {
      setError(errorMessage(rotateError));
    } finally {
      setBusy(false);
    }
  }

  if (newKey) {
    return (
      <div className="flex flex-col gap-3">
        <p role="status" className="text-[13px] text-success">
          Toutes les données sont rechiffrées. Le nouveau mot de passe est en place.
        </p>
        <RecoveryKeyPanel recoveryKey={newKey} doneLabel="Terminé" onDone={() => setNewKey(null)} />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <h3 className="text-[13px] font-medium">Rechiffrer toutes les données</h3>
      <p className="text-[12.5px] text-fg-muted">
        À faire si le mot de passe ou la clé de secours ont pu être vus par quelqu’un qui a aussi
        une copie des données (sauvegarde, ancien Mac). Changer seulement le mot de passe ne suffit
        pas dans ce cas : la clé de chiffrement reste la même.
      </p>
      {open ? (
        <form onSubmit={(event) => void submit(event)} className="flex flex-col gap-3">
          <label className={labelClass}>
            Mot de passe actuel
            <input
              type="password"
              autoComplete="current-password"
              autoFocus
              value={current}
              onChange={(event) => setCurrent(event.target.value)}
              disabled={busy}
              className={fieldClass}
            />
          </label>
          <NewPasswordFields value={value} onChange={setValue} showErrors={showErrors} />
          {error && (
            <p role="alert" className="text-[13px] text-danger">
              {error}
            </p>
          )}
          {busy && (
            <p role="status" className="text-[13px] text-fg-muted">
              Rechiffrement en cours… Cela peut prendre un moment s’il y a beaucoup de photos.
            </p>
          )}
          <div className="flex gap-2">
            <button type="submit" disabled={busy} className={btnPrimary}>
              {busy ? "Rechiffrement…" : "Rechiffrer les données…"}
            </button>
            <button type="button" onClick={close} disabled={busy} className={btnGhost}>
              Annuler
            </button>
          </div>
        </form>
      ) : (
        <div>
          <button type="button" onClick={() => setOpen(true)} className={btnGhost}>
            Rechiffrer avec une nouvelle clé…
          </button>
        </div>
      )}
    </div>
  );
}
