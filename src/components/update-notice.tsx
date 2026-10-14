import { relaunch } from "@tauri-apps/plugin-process";
import { check, type Update } from "@tauri-apps/plugin-updater";
import { useEffect, useRef, useState } from "react";

const installButtonClass =
  "inline-flex shrink-0 items-center rounded-pill bg-accent px-3.5 py-1.5 text-[13px] font-medium text-accent-fg transition-[filter] hover:brightness-110 disabled:opacity-45";

function isDesktopApp() {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

export function UpdateNotice() {
  const [update, setUpdate] = useState<Update | null>(null);
  const [phase, setPhase] = useState<"ready" | "download" | "install">("ready");
  const [received, setReceived] = useState(0);
  const [total, setTotal] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const updateRef = useRef<Update | null>(null);
  const installingRef = useRef(false);

  useEffect(() => {
    updateRef.current = update;
  }, [update]);

  useEffect(() => {
    if (!isDesktopApp()) return;

    let cancelled = false;
    void check({ timeout: 10_000 })
      .then((found) => {
        if (cancelled) {
          void found?.close();
          return;
        }
        setUpdate(found);
      })
      .catch(() => {
        // Hors ligne, release encore privée, ou lancement depuis le serveur de développement.
      });

    return () => {
      cancelled = true;
      if (!installingRef.current) void updateRef.current?.close();
    };
  }, []);

  async function install() {
    if (!update || phase !== "ready") return;
    installingRef.current = true;
    setPhase("download");
    setError(null);
    setReceived(0);
    setTotal(null);

    try {
      await update.downloadAndInstall((event) => {
        if (event.event === "Started") {
          setTotal(event.data.contentLength ?? null);
        } else if (event.event === "Progress") {
          setReceived((current) => current + event.data.chunkLength);
        } else {
          setPhase("install");
        }
      });
      await relaunch();
    } catch (cause) {
      installingRef.current = false;
      setPhase("ready");
      const detail = cause instanceof Error ? cause.message : String(cause);
      setError(`L’installation n’a pas abouti. ${detail}`);
    }
  }

  if (!update) return null;

  const percent =
    total !== null && total > 0 ? Math.min(100, Math.round((received / total) * 100)) : null;
  const status =
    phase === "install"
      ? `Installation de la version ${update.version}…`
      : phase === "download"
        ? percent === null
          ? `Téléchargement de la version ${update.version}…`
          : `Téléchargement de la version ${update.version}… ${percent} %`
        : `La version ${update.version} est disponible. Tracink va se fermer, puis se rouvrir.`;

  return (
    <div className="flex items-center justify-between gap-4 border-b border-line bg-surface px-8 py-3">
      <div className="min-w-0">
        <p className="text-[13px] text-fg">{status}</p>
        {error ? <p className="mt-1 text-[13px] text-danger">{error}</p> : null}
      </div>
      <button
        type="button"
        className={installButtonClass}
        onClick={() => void install()}
        disabled={phase !== "ready"}
      >
        {phase === "ready" ? "Installer" : "Installation…"}
      </button>
    </div>
  );
}
