import { useState } from "react";
import { btnGhost, btnPrimary } from "../../components/styles";

/**
 * Clé de secours montrée une seule fois. Le bouton reste inactif tant que la
 * tatoueuse n'a pas coché qu'elle l'a notée.
 */
export function RecoveryKeyPanel({
  recoveryKey,
  onDone,
  doneLabel = "Continuer",
}: {
  recoveryKey: string;
  onDone: () => void;
  doneLabel?: string;
}) {
  const [noted, setNoted] = useState(false);
  const [copied, setCopied] = useState<"ok" | "failed" | null>(null);

  async function copy() {
    try {
      await navigator.clipboard.writeText(recoveryKey);
      setCopied("ok");
    } catch {
      setCopied("failed");
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h2 className="text-[16px] font-medium tracking-tight">Votre clé de secours</h2>
        <p className="mt-1 text-[13px] text-fg-muted">
          Elle remplace le mot de passe s’il est oublié, et ouvre les sauvegardes. Elle ne sera plus
          jamais affichée.
        </p>
      </div>

      <p
        className="rounded-md border border-line-strong bg-bg px-4 py-3 text-center font-mono text-[18px] tracking-[0.08em] text-fg select-all"
        aria-label="Clé de secours"
      >
        {recoveryKey}
      </p>

      <div className="flex items-center gap-3">
        <button type="button" onClick={() => void copy()} className={btnGhost}>
          Copier
        </button>
        {copied === "ok" && (
          <span role="status" className="text-[12.5px] text-fg-muted">
            Copiée. Collez-la dans un endroit sûr, puis videz le presse-papiers.
          </span>
        )}
        {copied === "failed" && (
          <span role="status" className="text-[12.5px] text-danger">
            Copie impossible : recopiez-la à la main.
          </span>
        )}
      </div>

      <ul className="flex list-disc flex-col gap-1 pl-5 text-[13px] text-fg-muted">
        <li>
          Écrivez-la sur papier et rangez-la hors de l’atelier (ou dans un gestionnaire de mots de
          passe).
        </li>
        <li>Ne la gardez pas sur ce Mac : elle doit servir si le Mac est perdu ou en panne.</li>
        <li>
          Sans mot de passe ni clé de secours, les données sont perdues : personne ne peut les
          déchiffrer.
        </li>
      </ul>

      <label className="flex items-start gap-2.5 text-[13.5px] text-fg">
        <input
          type="checkbox"
          checked={noted}
          onChange={(event) => setNoted(event.target.checked)}
          className="mt-1 accent-[var(--accent)]"
        />
        J’ai noté la clé de secours en lieu sûr.
      </label>

      <div>
        <button type="button" disabled={!noted} onClick={onDone} className={btnPrimary}>
          {doneLabel}
        </button>
      </div>
    </div>
  );
}
