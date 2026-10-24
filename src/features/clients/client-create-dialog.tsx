import { useEffect, useId, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { btnGhost, btnPrimary, fieldClass, labelClass } from "../../components/styles";
import { useConfirm } from "../../components/use-confirm";
import { useClientsStore, type Client, type ClientInput } from "../../stores/clients-store";
import { toast } from "../../stores/toast-store";

const emptyToNull = (value: string) => (value.trim() === "" ? null : value.trim());

/**
 * Création rapide d'un client sans quitter l'écran en cours (séance).
 * La fiche complète (naissance, adresse, notes) se fait ensuite dans Clients.
 */
export function ClientCreateDialog({
  onCreated,
  onClose,
}: {
  onCreated: (client: Client) => void;
  onClose: () => void;
}) {
  const create = useClientsStore((state) => state.create);
  const confirm = useConfirm();
  const titleId = useId();
  const descriptionId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const firstNameRef = useRef<HTMLInputElement>(null);
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [phone, setPhone] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dirty = firstName.trim() !== "" || lastName.trim() !== "" || phone.trim() !== "";

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    firstNameRef.current?.focus();
    return () => previous?.focus?.();
  }, []);

  async function requestClose() {
    if (saving) return;
    if (dirty) {
      const ok = await confirm({
        title: "Abandonner ce client ?",
        body: "Ce que tu as saisi ne sera pas enregistré. La séance reste ouverte.",
        confirmLabel: "Abandonner",
        cancelLabel: "Continuer la saisie",
        tone: "danger",
      });
      if (!ok) return;
    }
    onClose();
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const input: ClientInput = {
      firstName: firstName.trim(),
      lastName: lastName.trim(),
      birthDate: null,
      address: null,
      email: null,
      phone: emptyToNull(phone),
      notes: null,
    };
    setSaving(true);
    setError(null);
    try {
      const saved = await create(input);
      toast.success("Client créé");
      onCreated(saved);
    } catch (submitError) {
      setError(String(submitError));
      setSaving(false);
    }
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      void requestClose();
      return;
    }
    if (event.key !== "Tab") return;
    const focusable = panelRef.current?.querySelectorAll<HTMLElement>(
      "button:not([disabled]), textarea, input, select, [tabindex]:not([tabindex='-1'])",
    );
    if (!focusable || focusable.length === 0) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-black/50 p-6 motion-safe:animate-[confirm-fade_var(--t-fast)_var(--ease-out)]"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) void requestClose();
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        onKeyDown={onKeyDown}
        className="w-full max-w-lg rounded-lg border border-line-strong bg-surface p-5 shadow-2xl motion-safe:animate-[confirm-pop_var(--t-base)_var(--ease-out)]"
      >
        <h2 id={titleId} className="text-[16px] font-medium tracking-tight text-fg">
          Nouveau client
        </h2>
        <p id={descriptionId} className="mt-2 text-[13.5px] text-fg-muted">
          Il est enregistré tout de suite et choisi pour cette séance. La date de naissance,
          l'adresse et les notes se complètent ensuite dans sa fiche.
        </p>

        <form onSubmit={(event) => void submit(event)} className="mt-4 flex flex-col gap-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <label className={labelClass}>
              Prénom *
              <input
                ref={firstNameRef}
                required
                autoComplete="given-name"
                value={firstName}
                onChange={(event) => setFirstName(event.target.value)}
                className={fieldClass}
              />
            </label>
            <label className={labelClass}>
              Nom *
              <input
                required
                autoComplete="family-name"
                value={lastName}
                onChange={(event) => setLastName(event.target.value)}
                className={fieldClass}
              />
            </label>
          </div>
          <label className={labelClass}>
            Téléphone
            <input
              type="tel"
              autoComplete="tel"
              value={phone}
              onChange={(event) => setPhone(event.target.value)}
              placeholder="Ex. 06 12 34 56 78"
              className={fieldClass}
            />
          </label>

          {error && (
            <p role="alert" className="text-[13px] text-danger">
              {error}
            </p>
          )}

          <div className="mt-2 flex justify-end gap-2">
            <button type="button" onClick={() => void requestClose()} className={btnGhost}>
              Annuler
            </button>
            <button type="submit" disabled={saving} className={btnPrimary}>
              {saving ? "Enregistrement…" : "Créer et choisir"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
