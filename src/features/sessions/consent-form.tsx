import { useState, type ReactNode } from "react";
import { btnGhost, btnPrimary, cardClass, fieldClass, labelClass } from "../../components/styles";
import { useGuardedLeave, useUnsavedChanges } from "../../components/unsaved-changes";
import { useConfirm } from "../../components/use-confirm";
import { formatIsoDate } from "../../lib/format";
import {
  emptyConsentAnswers,
  usePaperworkStore,
  type ConsentAnswers,
  type Guardian,
  type GuardianRelation,
  type Paperwork,
} from "../../stores/paperwork-store";

type BoxKey = Exclude<keyof ConsentAnswers, "guardian">;

const INFORMED: [BoxKey, string][] = [
  ["informedNature", "La nature de la prestation"],
  ["informedProcess", "Son déroulement"],
  ["informedBenefits", "Les bénéfices attendus"],
  ["informedRisks", "Les risques et complications possibles"],
  ["informedContraindications", "Les contre-indications éventuelles"],
  ["informedAftercare", "Les conseils post-acte"],
  ["informedWarningSigns", "Les signes d'alerte nécessitant une consultation médicale"],
  ["informedHealing", "Les modalités de cicatrisation"],
];

const DECLARED: [BoxKey, string][] = [
  ["declaredHealthAnswers", "Avoir répondu sincèrement au questionnaire de santé."],
  [
    "declaredTreatments",
    "Avoir signalé ses traitements médicaux, allergies et antécédents connus.",
  ],
  [
    "declaredNotImpaired",
    "Ne pas être sous l'emprise d'alcool ou de substances susceptibles d'altérer son consentement.",
  ],
  ["declaredUnderstood", "Avoir compris les informations communiquées."],
  ["declaredAftercareCommitment", "S'engager à respecter les recommandations post-acte remises."],
];

const CONSENT: [BoxKey, string][] = [
  ["consents", "Consent librement à la réalisation de la prestation demandée."],
  [
    "questionsAnswered",
    "A eu la possibilité de poser toutes ses questions et a obtenu des réponses satisfaisantes.",
  ],
];

const RELATIONS: [GuardianRelation, string][] = [
  ["FATHER", "Père"],
  ["MOTHER", "Mère"],
  ["LEGAL_GUARDIAN", "Tuteur légal"],
];

const emptyGuardian = (): Guardian => ({ relation: null, lastName: null, firstName: null });
const emptyToNull = (value: string) => (value.trim() === "" ? null : value);

export function ConsentFormView({
  paperwork,
  onDone,
}: {
  paperwork: Paperwork;
  onDone: (next?: Paperwork) => void;
}) {
  const { saveConsent, print } = usePaperworkStore();
  const confirm = useConfirm();
  const guardedLeave = useGuardedLeave();
  const signed = paperwork.consentSigned;
  const [answers, setAnswers] = useState<ConsentAnswers>(
    paperwork.consent?.answers ?? emptyConsentAnswers(),
  );
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useUnsavedChanges(dirty);

  const minor = paperwork.clientMinor;
  const guardian = answers.guardian ?? emptyGuardian();

  function setBox(key: BoxKey, value: boolean) {
    setAnswers((current) => ({ ...current, [key]: value }));
    setDirty(true);
  }

  function setGuardian(next: Partial<Guardian>) {
    setAnswers((current) => ({
      ...current,
      guardian: { ...(current.guardian ?? emptyGuardian()), ...next },
    }));
    setDirty(true);
  }

  function group(title: string, intro: string, items: [BoxKey, string][]): ReactNode {
    const allChecked = items.every(([key]) => answers[key]);
    return (
      <section className={`${cardClass} flex flex-col gap-3 p-4`}>
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-[12px] font-medium tracking-[0.06em] text-fg-faint uppercase">
              {title}
            </h2>
            <p className="mt-1 text-[13px] text-fg-muted">{intro}</p>
          </div>
          {!signed && items.length > 1 && (
            <button
              type="button"
              onClick={() => items.forEach(([key]) => setBox(key, !allChecked))}
              className={`${btnGhost} shrink-0`}
            >
              {allChecked ? "Tout décocher" : "Tout cocher"}
            </button>
          )}
        </div>
        <fieldset disabled={signed} className="flex flex-col gap-2">
          <legend className="sr-only">{title}</legend>
          {items.map(([key, label]) => (
            <label key={key} className="flex items-start gap-2.5 text-[13.5px] text-fg">
              <input
                type="checkbox"
                checked={answers[key]}
                onChange={(event) => setBox(key, event.target.checked)}
                className="mt-0.5 size-4 shrink-0 accent-[var(--accent)]"
              />
              {label}
            </label>
          ))}
        </fieldset>
      </section>
    );
  }

  async function save(thenPrint: boolean) {
    setSaving(true);
    setError(null);
    try {
      const next = await saveConsent(paperwork.sessionId, answers);
      setDirty(false);
      const missing = next.consent?.missing ?? [];
      if (thenPrint) {
        if (missing.length > 0) {
          const ok = await confirm({
            title: "Imprimer un consentement incomplet ?",
            details: missing.slice(0, 6).concat(missing.length > 6 ? ["…"] : []),
            body: "Les cases non cochées resteront vides sur le document imprimé.",
            confirmLabel: "Imprimer quand même",
            cancelLabel: "Retour",
          });
          if (!ok) {
            onDone(next);
            return;
          }
        }
        await print(paperwork.sessionId, "CONSENT");
      }
      onDone(next);
    } catch (saveError) {
      setError(String(saveError));
    } finally {
      setSaving(false);
    }
  }

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        void save(false);
      }}
      className="mx-auto flex max-w-2xl flex-col gap-4 px-8 py-10"
    >
      <div>
        <button
          type="button"
          onClick={() => void guardedLeave(() => onDone())}
          className="mb-4 text-[13px] text-fg-muted hover:text-fg"
        >
          ← Séance
        </button>
        <h1 className="text-[24px] font-medium tracking-tight">Consentement éclairé</h1>
        <p className="mt-1 text-[13px] text-fg-muted">
          {paperwork.clientFirstName} {paperwork.clientLastName} · séance du{" "}
          {formatIsoDate(paperwork.sessionDate)}
        </p>
      </div>

      {signed && (
        <p className="rounded-md border border-line bg-surface px-3 py-2 text-[13px] text-fg-muted">
          Le consentement signé est joint à la séance : les réponses sont figées. Pour corriger,
          annule le scan signé dans la séance puis fais signer un nouveau consentement.
        </p>
      )}

      <p className="text-[13px] text-fg-muted">
        Coche chaque point une fois qu&apos;il a été expliqué au client et qu&apos;il l&apos;a
        confirmé. Le document imprimé reprend ces cases ; le client le relit et le signe avec la
        mention « Lu et approuvé ».
      </p>

      {group(
        "Information préalable",
        "Le client reconnaît avoir reçu, à l'oral et à l'écrit, une information claire sur :",
        INFORMED,
      )}
      {group("Déclaration du client", "Le client déclare :", DECLARED)}
      {group(
        "Consentement",
        "Après avoir reçu toutes les informations nécessaires, le client :",
        CONSENT,
      )}

      <section className={`${cardClass} flex flex-col gap-3 p-4`}>
        <h2 className="text-[12px] font-medium tracking-[0.06em] text-fg-faint uppercase">
          Représentant légal
        </h2>
        {minor === true ? (
          <p className="rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-[13px] text-fg">
            <span aria-hidden="true">⚠︎ </span>
            Client mineur ({paperwork.clientAge} ans à la date de la séance) : l&apos;autorisation
            écrite d&apos;un représentant légal présent pendant l&apos;acte est obligatoire.
          </p>
        ) : minor === null ? (
          <p className="text-[13px] text-fg-muted">
            Date de naissance inconnue : la majorité ne peut pas être vérifiée. Renseigne-la dans la
            fiche client.
          </p>
        ) : (
          <p className="text-[13px] text-fg-muted">
            Client majeur : section à laisser vide, sauf cas particulier.
          </p>
        )}
        {minor !== false && (
          <fieldset disabled={signed} className="flex flex-col gap-3">
            <legend className="sr-only">Représentant légal</legend>
            <div role="radiogroup" aria-label="Lien avec le mineur" className="flex gap-2">
              {RELATIONS.map(([relation, label]) => {
                const selected = guardian.relation === relation;
                return (
                  <button
                    key={relation}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    onClick={() => setGuardian({ relation: selected ? null : relation })}
                    className={[
                      "rounded-pill px-3.5 py-1.5 text-[13px] font-medium transition-colors",
                      selected
                        ? "bg-accent text-accent-fg"
                        : "border border-line-strong text-fg-muted hover:bg-surface-3 hover:text-fg",
                    ].join(" ")}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className={labelClass}>
                Nom{minor ? " *" : ""}
                <input
                  value={guardian.lastName ?? ""}
                  onChange={(event) => setGuardian({ lastName: emptyToNull(event.target.value) })}
                  className={fieldClass}
                />
              </label>
              <label className={labelClass}>
                Prénom{minor ? " *" : ""}
                <input
                  value={guardian.firstName ?? ""}
                  onChange={(event) => setGuardian({ firstName: emptyToNull(event.target.value) })}
                  className={fieldClass}
                />
              </label>
            </div>
          </fieldset>
        )}
      </section>

      {error && <p className="text-[13px] text-danger">{error}</p>}

      {!signed && (
        <div className="sticky bottom-0 -mx-8 flex items-center gap-3 border-t border-line bg-bg/95 px-8 py-3 backdrop-blur">
          <button type="submit" disabled={saving} className={btnPrimary}>
            {saving ? "Enregistrement…" : "Enregistrer"}
          </button>
          <button
            type="button"
            disabled={saving}
            onClick={() => void save(true)}
            className={btnGhost}
          >
            Enregistrer et imprimer
          </button>
          <button
            type="button"
            onClick={() => void guardedLeave(() => onDone())}
            className={`${btnGhost} ml-auto`}
          >
            Annuler
          </button>
        </div>
      )}
    </form>
  );
}
