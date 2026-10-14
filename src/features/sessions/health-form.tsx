import { useId, useState, type ReactNode } from "react";
import { useGuardedLeave, useUnsavedChanges } from "../../components/unsaved-changes";
import { btnGhost, btnPrimary, cardClass, fieldClass, labelClass } from "../../components/styles";
import { useConfirm } from "../../components/use-confirm";
import { formatIsoDate } from "../../lib/format";
import {
  emptyHealthAnswers,
  usePaperworkStore,
  type Allergy,
  type HealthAnswers,
  type Paperwork,
  type ProfessionalDecision,
  type YesNo,
} from "../../stores/paperwork-store";

type YesNoKey = {
  [K in keyof HealthAnswers]: HealthAnswers[K] extends YesNo ? K : never;
}[keyof HealthAnswers];

const ALLERGIES: [Allergy, string][] = [
  ["NICKEL", "Nickel"],
  ["LATEX", "Latex"],
  ["ANTISEPTICS", "Antiseptiques"],
  ["INKS", "Encres ou pigments"],
  ["MEDICATIONS", "Médicaments"],
  ["OTHER", "Autre"],
];

const DECISIONS: [ProfessionalDecision, string][] = [
  ["POSSIBLE", "Prestation possible"],
  ["POSTPONE", "Report conseillé"],
  ["MEDICAL_ADVICE", "Avis médical"],
];

const emptyToNull = (value: string) => (value.trim() === "" ? null : value);

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className={`${cardClass} flex flex-col gap-4 p-4`}>
      <h2 className="text-[12px] font-medium tracking-[0.06em] text-fg-faint uppercase">{title}</h2>
      {children}
    </section>
  );
}

/** Question Oui / Non : deux boutons radio, réponse effaçable. */
function YesNoQuestion({
  label,
  value,
  onChange,
  disabled,
}: {
  label: string;
  value: YesNo;
  onChange: (value: YesNo) => void;
  disabled: boolean;
}) {
  const id = useId();
  const option = (answer: boolean, text: string) => {
    const selected = value === answer;
    return (
      <button
        type="button"
        role="radio"
        aria-checked={selected}
        disabled={disabled}
        onClick={() => onChange(selected ? null : answer)}
        className={[
          "min-w-14 rounded-pill px-3 py-1 text-[13px] font-medium transition-colors disabled:cursor-not-allowed",
          selected
            ? answer
              ? "bg-warning text-bg"
              : "bg-accent text-accent-fg"
            : "border border-line-strong text-fg-muted hover:bg-surface-3 hover:text-fg",
        ].join(" ")}
      >
        {text}
      </button>
    );
  };
  return (
    <div className="flex items-center justify-between gap-4">
      <span id={id} className="text-[13.5px] text-fg">
        {label}
      </span>
      <div role="radiogroup" aria-labelledby={id} className="flex shrink-0 gap-1.5">
        {option(true, "Oui")}
        {option(false, "Non")}
      </div>
    </div>
  );
}

export function HealthFormView({
  paperwork,
  onDone,
}: {
  paperwork: Paperwork;
  onDone: (next?: Paperwork) => void;
}) {
  const { saveHealth, print } = usePaperworkStore();
  const confirm = useConfirm();
  const guardedLeave = useGuardedLeave();
  const signed = paperwork.healthSigned;
  const [answers, setAnswers] = useState<HealthAnswers>(
    paperwork.health?.answers ?? emptyHealthAnswers(),
  );
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useUnsavedChanges(dirty);

  function update<K extends keyof HealthAnswers>(key: K, value: HealthAnswers[K]) {
    setAnswers((current) => ({ ...current, [key]: value }));
    setDirty(true);
  }

  function yesNo(key: YesNoKey, label: string) {
    return (
      <YesNoQuestion
        label={label}
        value={answers[key]}
        onChange={(value) => update(key, value)}
        disabled={signed}
      />
    );
  }

  function toggleAllergy(allergy: Allergy) {
    const has = answers.allergies.includes(allergy);
    setAnswers((current) => ({
      ...current,
      allergies: has
        ? current.allergies.filter((item) => item !== allergy)
        : [...current.allergies, allergy],
      allergyOther: allergy === "OTHER" && has ? null : current.allergyOther,
    }));
    setDirty(true);
  }

  async function save(thenPrint: boolean) {
    setSaving(true);
    setError(null);
    try {
      const cleaned: HealthAnswers = {
        ...answers,
        healingTreatmentDetails:
          answers.healingTreatment === true ? answers.healingTreatmentDetails : null,
      };
      const next = await saveHealth(paperwork.sessionId, cleaned);
      setDirty(false);
      const missing = next.health?.missing ?? [];
      if (thenPrint) {
        if (missing.length > 0) {
          const ok = await confirm({
            title: "Imprimer un questionnaire incomplet ?",
            details: missing.slice(0, 6).concat(missing.length > 6 ? ["…"] : []),
            body: `${missing.length} réponse${missing.length > 1 ? "s manquent" : " manque"}. Le client pourra compléter à la main avant de signer.`,
            confirmLabel: "Imprimer quand même",
            cancelLabel: "Retour",
          });
          if (!ok) {
            onDone(next);
            return;
          }
        }
        await print(paperwork.sessionId, "HEALTH");
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
        <h1 className="text-[24px] font-medium tracking-tight">Questionnaire de santé</h1>
        <p className="mt-1 text-[13px] text-fg-muted">
          {paperwork.clientFirstName} {paperwork.clientLastName} · séance du{" "}
          {formatIsoDate(paperwork.sessionDate)}
        </p>
      </div>

      {signed && (
        <p className="rounded-md border border-line bg-surface px-3 py-2 text-[13px] text-fg-muted">
          Le questionnaire signé est joint à la séance : les réponses sont figées. Pour corriger,
          annule le scan signé dans la séance puis fais signer un nouveau questionnaire.
        </p>
      )}

      <Section title="État général">
        {yesNo("sickOrFever", "Malade ou fièvre actuellement ?")}
        {yesNo("currentInfection", "Infection en cours ?")}
        {yesNo("recentSurgery", "Intervention chirurgicale récente ?")}
      </Section>

      <Section title="Antécédents médicaux">
        {yesNo("diabetes", "Diabétique ?")}
        {yesNo("coagulationDisorder", "Trouble de la coagulation ?")}
        {yesNo("immunodeficiency", "Immunodéprimé(e) ou traitement immunosuppresseur ?")}
        {yesNo("heartDisease", "Maladie cardiaque ?")}
        {yesNo("epilepsy", "Épileptique ?")}
      </Section>

      <Section title="Traitements en cours">
        {yesNo("anticoagulant", "Traitement anticoagulant ?")}
        {yesNo("healingTreatment", "Traitement susceptible d'influencer la cicatrisation ?")}
        {answers.healingTreatment === true && (
          <label className={labelClass}>
            Lequel ? *
            <textarea
              rows={2}
              value={answers.healingTreatmentDetails ?? ""}
              onChange={(event) =>
                update("healingTreatmentDetails", emptyToNull(event.target.value))
              }
              disabled={signed}
              className={fieldClass}
            />
          </label>
        )}
      </Section>

      <Section title="Allergies">
        <fieldset disabled={signed} className="flex flex-col gap-2">
          <legend className="mb-2 text-[13.5px] text-fg">
            Allergique à l&apos;un des éléments suivants ?
          </legend>
          <div className="grid grid-cols-2 gap-2">
            {ALLERGIES.map(([allergy, label]) => (
              <label
                key={allergy}
                className="flex items-center gap-2 text-[13.5px] text-fg disabled:cursor-not-allowed"
              >
                <input
                  type="checkbox"
                  checked={answers.allergies.includes(allergy)}
                  onChange={() => toggleAllergy(allergy)}
                  className="size-4 accent-[var(--accent)]"
                />
                {label}
              </label>
            ))}
          </div>
        </fieldset>
        {answers.allergies.includes("OTHER") && (
          <label className={labelClass}>
            Autre allergie *
            <input
              value={answers.allergyOther ?? ""}
              onChange={(event) => update("allergyOther", emptyToNull(event.target.value))}
              disabled={signed}
              className={fieldClass}
            />
          </label>
        )}
      </Section>

      <Section title="Situations particulières">
        {yesNo("pregnantOrBreastfeeding", "Enceinte ou allaitement ?")}
        {yesNo("severeAllergicReaction", "Déjà présenté une réaction allergique importante ?")}
        {yesNo("skinLesionOnArea", "Lésion cutanée sur la zone à tatouer ?")}
        <label className={labelClass}>
          Précisions du client
          <textarea
            rows={3}
            value={answers.details ?? ""}
            onChange={(event) => update("details", emptyToNull(event.target.value))}
            disabled={signed}
            className={fieldClass}
          />
        </label>
      </Section>

      <Section title="Réservé au professionnel">
        <div role="radiogroup" aria-label="Avis du professionnel" className="flex flex-wrap gap-2">
          {DECISIONS.map(([decision, label]) => {
            const selected = answers.professionalDecision === decision;
            return (
              <button
                key={decision}
                type="button"
                role="radio"
                aria-checked={selected}
                disabled={signed}
                onClick={() => update("professionalDecision", selected ? null : decision)}
                className={[
                  "rounded-pill px-3.5 py-1.5 text-[13px] font-medium transition-colors disabled:cursor-not-allowed",
                  selected
                    ? decision === "POSSIBLE"
                      ? "bg-accent text-accent-fg"
                      : "bg-warning text-bg"
                    : "border border-line-strong text-fg-muted hover:bg-surface-3 hover:text-fg",
                ].join(" ")}
              >
                {label}
              </button>
            );
          })}
        </div>
        <label className={labelClass}>
          Commentaires
          <textarea
            rows={2}
            value={answers.professionalComments ?? ""}
            onChange={(event) => update("professionalComments", emptyToNull(event.target.value))}
            disabled={signed}
            className={fieldClass}
          />
        </label>
      </Section>

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
