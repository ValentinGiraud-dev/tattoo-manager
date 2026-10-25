import { useRef, useState } from "react";
import { btnPrimary, fieldClass, labelClass } from "../../components/styles";
import { useConfirm } from "../../components/use-confirm";
import { formatTimestamp } from "../../lib/format";
import {
  useSessionsStore,
  type Readiness,
  type SessionListItem,
} from "../../stores/sessions-store";
import { toast } from "../../stores/toast-store";

const CHOICES: { value: Readiness; label: string; tone: "accent" | "warning" }[] = [
  { value: "FEASIBLE", label: "Réalisable", tone: "accent" },
  { value: "IMPOSSIBLE", label: "Pas possible", tone: "warning" },
  { value: "POSTPONED", label: "Décaler", tone: "warning" },
];

const ATTESTATION =
  "Je valide et certifie mes choix pour la prestation, ainsi que la fiche de soin est transmise.";

function missingScans(healthSigned: boolean, consentSigned: boolean): string | null {
  if (healthSigned && consentSigned) return null;
  if (!healthSigned && !consentSigned) {
    return "Il manque le questionnaire de santé signé et le consentement signé.";
  }
  if (!healthSigned) return "Il manque le questionnaire de santé signé.";
  return "Il manque le consentement signé.";
}

function blockReason(
  choice: Readiness | null,
  sessionStatus: string,
  healthSigned: boolean,
  consentSigned: boolean,
): string | null {
  if ((choice === "POSTPONED" || choice === "IMPOSSIBLE") && sessionStatus === "COMPLETED") {
    return "Une séance terminée ne peut plus être reportée ou annulée depuis les documents.";
  }
  if (choice === "FEASIBLE") return missingScans(healthSigned, consentSigned);
  return null;
}

/**
 * Choix Réalisable / Pas possible / Décaler, puis validation datée et définitive.
 */
export function SessionReadiness({
  sessionId,
  sessionStatus,
  healthSigned,
  consentSigned,
  readiness,
  reason: savedReason,
  validatedAt,
  readOnly = false,
  onValidated,
}: {
  sessionId: string;
  sessionStatus: string;
  healthSigned: boolean;
  consentSigned: boolean;
  readiness: Readiness | null;
  reason: string | null;
  validatedAt: string | null;
  readOnly?: boolean;
  onValidated: (session: SessionListItem) => void | Promise<void>;
}) {
  const confirm = useConfirm();
  const validateReadiness = useSessionsStore((state) => state.validateReadiness);
  const [choice, setChoice] = useState<Readiness | null>(null);
  const [reason, setReason] = useState("");
  const [certified, setCertified] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submitting = useRef(false);

  if (validatedAt && readiness) {
    return (
      <div className="flex flex-col gap-3 border-t border-line px-4 py-4">
        <fieldset disabled>
          <legend className={labelClass}>La prestation est</legend>
          <div className="mt-2 flex flex-wrap gap-x-6 gap-y-2">
            {CHOICES.map((option) => (
              <Choice
                key={option.value}
                name={`readiness-${sessionId}`}
                option={option}
                checked={readiness === option.value}
                onChange={() => undefined}
              />
            ))}
          </div>
        </fieldset>
        {savedReason && (
          <p className="text-[13.5px] text-fg">
            <span className="text-fg-muted">Motif · </span>
            {savedReason}
          </p>
        )}
        <p className="text-[13.5px] text-fg">{ATTESTATION}</p>
        <p className="text-[12.5px] text-fg-faint">Validé le {formatTimestamp(validatedAt)}</p>
      </div>
    );
  }

  if (readOnly) {
    return (
      <p className="border-t border-line px-4 py-3 text-[13px] text-fg-muted">Pas encore validé.</p>
    );
  }

  const hint = blockReason(choice, sessionStatus, healthSigned, consentSigned);
  const needsReason = choice === "POSTPONED" || choice === "IMPOSSIBLE";
  const canSubmit =
    choice !== null &&
    certified &&
    hint === null &&
    (!needsReason || reason.trim() !== "") &&
    !busy;

  async function submit() {
    if (!choice || !canSubmit || submitting.current) return;
    submitting.current = true;
    const motif = reason.trim();
    const statusLine =
      choice === "FEASIBLE"
        ? "Le statut de la séance ne change pas."
        : choice === "IMPOSSIBLE"
          ? sessionStatus === "CANCELLED"
            ? "La séance reste au statut Annulée."
            : "La séance passera au statut Annulée."
          : sessionStatus === "RESCHEDULED"
            ? "La séance reste au statut Reportée."
            : "La séance passera au statut Reportée.";
    const ok = await confirm({
      title:
        choice === "FEASIBLE"
          ? "Valider cette séance comme réalisable ?"
          : choice === "IMPOSSIBLE"
            ? "Valider que la prestation n'est pas possible ?"
            : "Valider le report de la prestation ?",
      details:
        choice === "FEASIBLE"
          ? [
              "Questionnaire de santé validé",
              "Consentement éclairé validé",
              "Fiche de soin transmise",
              statusLine,
            ]
          : [motif, statusLine],
      body:
        choice === "FEASIBLE"
          ? "Tu certifies avoir vérifié les documents et que le client est apte à être tatoué. Le choix et l'heure restent dans l'historique. Cette validation est définitive."
          : choice === "IMPOSSIBLE"
            ? "Tu certifies que les documents indiquent que le client n'est pas apte. Le choix, le motif et l'heure restent dans l'historique. Cette validation est définitive. S'il reste un acompte, tu choisiras ensuite ce qu'il en devient."
            : "Tu certifies que la prestation est décalée. Le choix, le motif et l'heure restent dans l'historique. Cette validation est définitive.",
      confirmLabel: "Valider définitivement",
      cancelLabel: "Retour",
      tone: choice === "IMPOSSIBLE" ? "danger" : "default",
    });
    if (!ok) {
      submitting.current = false;
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const saved = await validateReadiness(
        sessionId,
        choice,
        choice === "FEASIBLE" ? null : motif,
      );
      toast.success("Documents validés");
      void onValidated(saved);
    } catch (validateError) {
      setError(String(validateError));
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-4 border-t border-line px-4 py-4">
      <fieldset>
        <legend className={labelClass}>La prestation est</legend>
        <div className="mt-2 flex flex-wrap gap-x-6 gap-y-2">
          {CHOICES.map((option) => (
            <Choice
              key={option.value}
              name={`readiness-${sessionId}`}
              option={option}
              checked={choice === option.value}
              onChange={() => {
                setChoice(option.value);
                setCertified(false);
                if (option.value === "FEASIBLE") setReason("");
              }}
            />
          ))}
        </div>
      </fieldset>
      {choice !== null && choice !== "FEASIBLE" && (
        <label className={labelClass}>
          Motif *
          <input
            value={reason}
            disabled={busy}
            onChange={(event) => setReason(event.target.value)}
            placeholder="Ex. peau irritée"
            className={fieldClass}
          />
        </label>
      )}
      {hint && choice !== null && <p className="text-[13px] text-warning">{hint}</p>}
      {error && <p className="text-[13px] text-danger">{error}</p>}
      <div className="flex items-center gap-4">
        <label className="flex min-w-0 flex-1 items-start gap-2.5 text-[13.5px] text-fg">
          <input
            type="checkbox"
            checked={certified}
            disabled={busy || choice === null}
            onChange={(event) => setCertified(event.target.checked)}
            className="mt-0.5 size-4 shrink-0 accent-[var(--accent)]"
          />
          {ATTESTATION}
        </label>
        <button
          type="button"
          disabled={!canSubmit}
          onClick={() => void submit()}
          className={`${btnPrimary} shrink-0`}
        >
          {busy ? "Validation…" : "Valider"}
        </button>
      </div>
    </div>
  );
}

function Choice({
  name,
  option,
  checked,
  onChange,
}: {
  name: string;
  option: (typeof CHOICES)[number];
  checked: boolean;
  onChange: () => void;
}) {
  return (
    <label className="inline-flex items-center gap-2 text-[14px] text-fg">
      <input
        type="radio"
        name={name}
        value={option.value}
        checked={checked}
        onChange={onChange}
        className={`size-4 ${option.tone === "accent" ? "accent-[var(--accent)]" : "accent-[var(--warning)]"}`}
      />
      {option.label}
    </label>
  );
}
