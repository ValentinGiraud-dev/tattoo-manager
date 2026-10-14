import { useState, type FormEvent } from "react";
import { btnPrimary, cardClass, fieldClass, labelClass } from "../../components/styles";
import { useUnsavedChanges } from "../../components/unsaved-changes";
import { useSettingsStore, type AppSettings } from "../../stores/settings-store";

function StudioForm({ settings }: { settings: AppSettings }) {
  const updateSettings = useSettingsStore((state) => state.updateSettings);
  const [professionalName, setProfessionalName] = useState(settings.studio.professionalName);
  const [city, setCity] = useState(settings.studio.city);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dirty =
    professionalName !== settings.studio.professionalName || city !== settings.studio.city;
  useUnsavedChanges(dirty);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      await updateSettings({
        ...settings,
        studio: { professionalName: professionalName.trim(), city: city.trim() },
      });
      setSaved(true);
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
      <div>
        <h2 className="text-[14px] font-medium">Atelier</h2>
        <p className="mt-0.5 text-[12.5px] text-fg-muted">Reporté sur le consentement imprimé.</p>
      </div>
      <label className={labelClass}>
        Professionnel réalisant l&apos;acte
        <input
          value={professionalName}
          onChange={(event) => {
            setProfessionalName(event.target.value);
            setSaved(false);
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
            setSaved(false);
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
        {saved && !dirty && (
          <span role="status" className="text-[13px] text-success">
            Enregistré
          </span>
        )}
      </div>
    </form>
  );
}

export default function SettingsPage() {
  const { settings, paths, loaded, error } = useSettingsStore();

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
      {paths && (
        <section className={`${cardClass} flex flex-col gap-2 p-4`}>
          <h2 className="text-[14px] font-medium">Données</h2>
          <dl className="grid gap-2 text-[12.5px]">
            {(
              [
                ["Base", paths.database],
                ["Documents", paths.documents],
                ["Sauvegardes", paths.backups],
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
    </div>
  );
}
