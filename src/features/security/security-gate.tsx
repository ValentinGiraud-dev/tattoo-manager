import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { btnGhost, btnPrimary } from "../../components/styles";
import { useBackupStore } from "../../stores/backup-store";
import { errorMessage, useSecurityStore } from "../../stores/security-store";
import { LockScreen } from "./lock-screen";
import { RecoveryKeyPanel } from "./recovery-key-panel";
import { ScreenFrame } from "./screen-frame";
import { SetupScreen } from "./setup-screen";

const ACTIVITY_EVENTS = ["mousemove", "mousedown", "keydown", "wheel", "touchstart"] as const;
const BACKUP_CHECK_MS = 30 * 60 * 1000;

/** Verrouille après `minutes` sans activité (0 = jamais). Vérifie aussi au réveil du Mac. */
function useIdleLock(minutes: number, active: boolean, lock: () => void) {
  useEffect(() => {
    if (!active || minutes <= 0) return;
    let last = Date.now();
    const touch = () => {
      last = Date.now();
    };
    for (const name of ACTIVITY_EVENTS) window.addEventListener(name, touch, { passive: true });
    const timer = window.setInterval(() => {
      if (Date.now() - last >= minutes * 60_000) lock();
    }, 15_000);
    return () => {
      for (const name of ACTIVITY_EVENTS) window.removeEventListener(name, touch);
      window.clearInterval(timer);
    };
  }, [active, minutes, lock]);
}

/** ⌘L verrouille l'app. */
function useLockShortcut(active: boolean, lock: () => void) {
  useEffect(() => {
    if (!active) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.metaKey && !event.shiftKey && !event.altKey && event.key.toLowerCase() === "l") {
        event.preventDefault();
        lock();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [active, lock]);
}

/** Sauvegarde au déverrouillage, puis toutes les 30 min si la dernière date de plus de 24 h. */
function useBackupSchedule(active: boolean) {
  const runIfDue = useBackupStore((state) => state.runIfDue);
  useEffect(() => {
    if (!active) return;
    void runIfDue();
    const timer = window.setInterval(() => void runIfDue(), BACKUP_CHECK_MS);
    return () => window.clearInterval(timer);
  }, [active, runIfDue]);
}

function TouchIdOffer({ onDone }: { onDone: () => void }) {
  const setTouchId = useSecurityStore((state) => state.setTouchId);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function enable() {
    setBusy(true);
    setError(null);
    try {
      await setTouchId(true);
      onDone();
    } catch (enableError) {
      setError(errorMessage(enableError));
      setBusy(false);
    }
  }

  return (
    <ScreenFrame>
      <div className="flex flex-col gap-4">
        <div>
          <h1 className="text-[18px] font-medium tracking-tight">Déverrouiller avec Touch ID ?</h1>
          <p className="mt-1.5 text-[13px] text-fg-muted">
            Une empreinte suffit pour rouvrir Tracink. Le mot de passe reste demandé si Touch ID
            échoue, et peut toujours être utilisé.
          </p>
        </div>
        {error && (
          <p role="alert" className="text-[13px] text-danger">
            {error}
          </p>
        )}
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => void enable()}
            disabled={busy}
            className={btnPrimary}
          >
            {busy ? "En attente de Touch ID…" : "Activer Touch ID"}
          </button>
          <button type="button" onClick={onDone} disabled={busy} className={btnGhost}>
            Plus tard
          </button>
        </div>
      </div>
    </ScreenFrame>
  );
}

/**
 * Rien de l'app n'est monté avant le premier déverrouillage. Ensuite l'app reste
 * montée (un formulaire en cours n'est pas perdu) mais elle est masquée et inerte
 * pendant les verrouillages.
 */
export function SecurityGate({ children }: { children: ReactNode }) {
  const { status, error, everUnlocked, pendingRecoveryKey, load, lock, acknowledgeRecoveryKey } =
    useSecurityStore();
  const [offerTouchId, setOfferTouchId] = useState(false);
  const locking = useRef(false);
  const unlocked = status?.state === "UNLOCKED";

  useEffect(() => {
    void load();
  }, [load]);

  const lockNow = useCallback(() => {
    if (locking.current) return;
    locking.current = true;
    lock()
      .catch(() => undefined)
      .finally(() => {
        locking.current = false;
      });
  }, [lock]);

  const ready = unlocked && everUnlocked;
  useIdleLock(status?.autoLockMinutes ?? 0, ready, lockNow);
  useLockShortcut(ready, lockNow);
  useBackupSchedule(ready);

  if (error && !status) {
    return (
      <ScreenFrame>
        <p role="alert" className="text-[13px] text-danger">
          {error}
        </p>
        <button type="button" onClick={() => void load()} className={`${btnGhost} mt-4`}>
          Réessayer
        </button>
      </ScreenFrame>
    );
  }
  if (!status) {
    return (
      <ScreenFrame>
        <p className="text-[13px] text-fg-muted">Chargement…</p>
      </ScreenFrame>
    );
  }
  if (pendingRecoveryKey) {
    return (
      <ScreenFrame wide>
        <RecoveryKeyPanel
          recoveryKey={pendingRecoveryKey}
          onDone={() => {
            setOfferTouchId(status.touchIdAvailable && !status.touchIdEnabled);
            acknowledgeRecoveryKey();
          }}
        />
      </ScreenFrame>
    );
  }
  if (offerTouchId) {
    return <TouchIdOffer onDone={() => setOfferTouchId(false)} />;
  }
  if (status.state === "SETUP_REQUIRED") {
    return <SetupScreen />;
  }
  if (!everUnlocked) {
    return <LockScreen autoTouchId />;
  }

  return (
    <>
      <div className="h-full" hidden={!unlocked} inert={!unlocked}>
        {children}
      </div>
      {!unlocked && <LockScreen autoTouchId={false} />}
    </>
  );
}
