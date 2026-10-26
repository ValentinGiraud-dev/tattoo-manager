import { useState, type FormEvent } from "react";
import { InfoTip } from "../../components/info-tip";
import { btnGhost, btnPrimary, cardClass, fieldClass, labelClass } from "../../components/styles";
import { useGuardedLeave, useUnsavedChanges } from "../../components/unsaved-changes";
import { useSecurityStore } from "../../stores/security-store";
import { useSettingsStore, type AppSettings } from "../../stores/settings-store";
import { useUIStore } from "../../stores/ui-store";
import { BackupSection } from "./backup-section";
import { DangerZone } from "./danger-zone";
import { SecuritySection } from "./security-section";
import { toast } from "../../stores/toast-store";

function StudioForm({ settings }: { settings: AppSettings }) {
  const updateSettings = useSettingsStore((state) => state.updateSettings);
  const [professionalName, setProfessionalName] = useState(settings.studio.professionalName);
  const [city, setCity] = useState(settings.studio.city);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dirty =
    professionalName !== settings.studio.professionalName || city !== settings.studio.city;
  useUnsavedChanges(dirty);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await updateSettings({
        ...settings,
        studio: { professionalName: professionalName.trim(), city: city.trim() },
      });
      toast.success("Réglages de l’atelier enregistrés");
    } catch (saveError) {
      setError(String(saveError));
    } finally {
      setSaving(false);
    }
  }

  return (
    <form
      onSubmit={(event) => void submit(event)}
      className={`${cardClass} flex flex-col gap-4 p-4`}
    >
      <div className="flex items-center gap-1">
        <h2 className="text-[14px] font-medium">Atelier</h2>
        <InfoTip label="Atelier">Reporté sur le consentement imprimé.</InfoTip>
      </div>
      <label className={labelClass}>
        Professionnel réalisant l&apos;acte
        <input
          value={professionalName}
          onChange={(event) => {
            setProfessionalName(event.target.value);
          }}
          placeholder="Prénom Nom"
          className={fieldClass}
        />
      </label>
      <label className={labelClass}>
        Ville (« Fait à »)
        <input
          value={city}
          onChange={(event) => {
            setCity(event.target.value);
          }}
          placeholder="Ex. Lyon"
          className={fieldClass}
        />
      </label>
      {error && <p className="text-[13px] text-danger">{error}</p>}
      <div className="flex items-center gap-3">
        <button type="submit" disabled={saving || !dirty} className={btnPrimary}>
          {saving ? "Enregistrement…" : "Enregistrer"}
        </button>
      </div>
    </form>
  );
}

function JournalSection() {
  const setPage = useUIStore((state) => state.setPage);
  const guardedLeave = useGuardedLeave();

  return (
    <section className={`${cardClass} flex items-center justify-between gap-4 p-4`}>
      <div className="flex min-w-0 items-center gap-1">
        <h2 className="text-[14px] font-medium">Journal</h2>
        <InfoTip label="Journal">
          Créations, modifications et annulations. Le journal ne s’efface pas.
        </InfoTip>
      </div>
      <button
        type="button"
        onClick={() => {
          void guardedLeave(() => setPage("journal"));
        }}
        className={`${btnGhost} shrink-0`}
      >
        Ouvrir le journal
      </button>
    </section>
  );
}

export default function SettingsPage() {
  const { settings, paths, loaded, error } = useSettingsStore();
  const securityStatus = useSecurityStore((state) => state.status);

  return (
    <div className="mx-auto flex max-w-xl flex-col gap-5 px-8 py-10">
      <h1 className="text-[24px] font-medium tracking-tight">Paramètres</h1>
      {!loaded ? (
        <p className="text-[13px] text-fg-muted">Chargement…</p>
      ) : error || !settings ? (
        <p className="text-[13px] text-danger">{error ?? "Paramètres indisponibles"}</p>
      ) : (
        <StudioForm settings={settings} />
      )}
      {securityStatus && <SecuritySection status={securityStatus} />}
      <BackupSection />
      {paths && (
        <section className={`${cardClass} flex flex-col gap-2 p-4`}>
          <div className="flex items-center gap-1">
            <h2 className="text-[14px] font-medium">Données sur ce Mac</h2>
            <InfoTip label="Données sur ce Mac">
              Chiffrées : ces fichiers ne s’ouvrent pas sans Tracink et son mot de passe.
            </InfoTip>
          </div>
          <dl className="grid gap-2 text-[12.5px]">
            {(
              [
                ["Base", paths.database],
                ["Documents", paths.documents],
                ["Copies auto.", paths.backups],
              ] as const
            ).map(([label, path]) => (
              <div key={label} className="grid grid-cols-[7rem_1fr] gap-3">
                <dt className="text-fg-faint">{label}</dt>
                <dd className="font-mono break-all text-fg-muted">{path}</dd>
              </div>
            ))}
          </dl>
        </section>
      )}
      <JournalSection />
      {securityStatus && <DangerZone touchIdEnabled={securityStatus.touchIdEnabled} />}
    </div>
  );
}
