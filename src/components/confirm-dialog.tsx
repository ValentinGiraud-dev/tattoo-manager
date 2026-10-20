import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import {
  ConfirmContext,
  type ConfirmFn,
  type ConfirmRequest as Request,
  type ConfirmResult,
  type ConfirmTone,
} from "./use-confirm";

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [request, setRequest] = useState<Request | null>(null);

  const confirm = useCallback<ConfirmFn>(
    (options) =>
      new Promise((resolve) => {
        setRequest((current) => {
          // Une seule demande à la fois : la précédente est considérée comme refusée.
          current?.resolve(null);
          return { ...options, resolve };
        });
      }),
    [],
  );

  const close = useCallback((result: ConfirmResult | null) => {
    setRequest((current) => {
      current?.resolve(result);
      return null;
    });
  }, []);

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      {request && <ConfirmDialog key={request.title} request={request} onClose={close} />}
    </ConfirmContext.Provider>
  );
}

const btnBase =
  "inline-flex items-center justify-center rounded-pill px-3.5 py-1.5 text-[13px] font-medium transition-[filter,background-color,color] disabled:opacity-45 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent";
const btnCancel = `${btnBase} border border-line-strong text-fg-muted hover:bg-surface-3 hover:text-fg`;
const btnConfirm: Record<ConfirmTone, string> = {
  default: `${btnBase} bg-accent text-accent-fg hover:brightness-110`,
  danger: `${btnBase} bg-danger text-bg hover:brightness-110`,
};

function ConfirmDialog({
  request,
  onClose,
}: {
  request: Request;
  onClose: (result: ConfirmResult | null) => void;
}) {
  const titleId = useId();
  const bodyId = useId();
  const reasonId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);
  const reasonRef = useRef<HTMLTextAreaElement>(null);
  const typedRef = useRef<HTMLInputElement>(null);
  const typedId = useId();
  const [reason, setReason] = useState("");
  const [typed, setTyped] = useState("");
  const tone = request.tone ?? "default";
  const [choice, setChoice] = useState<string | null>(request.defaultChoice ?? null);
  const reasonMissing = request.reason?.required === true && reason.trim() === "";
  const choiceMissing = (request.choices?.length ?? 0) > 0 && choice === null;
  const typedMissing =
    request.typeToConfirm !== undefined &&
    typed.trim().toLocaleUpperCase("fr-FR") !== request.typeToConfirm.toLocaleUpperCase("fr-FR");

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    if (request.reason) reasonRef.current?.focus();
    else if (request.typeToConfirm) typedRef.current?.focus();
    else if (tone === "danger") cancelRef.current?.focus();
    else confirmRef.current?.focus();
    return () => previous?.focus?.();
  }, [request.reason, request.typeToConfirm, tone]);

  function submit() {
    if (reasonMissing) {
      reasonRef.current?.focus();
      return;
    }
    if (choiceMissing || typedMissing) return;
    onClose({ reason: request.reason ? reason.trim() || null : null, choice });
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      onClose(null);
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
        if (event.target === event.currentTarget) onClose(null);
      }}
    >
      <div
        ref={panelRef}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={bodyId}
        onKeyDown={onKeyDown}
        className="w-full max-w-md rounded-lg border border-line-strong bg-surface p-5 shadow-2xl motion-safe:animate-[confirm-pop_var(--t-base)_var(--ease-out)]"
      >
        <h2 id={titleId} className="text-[16px] font-medium tracking-tight text-fg">
          {request.title}
        </h2>

        <div id={bodyId} className="mt-2 flex flex-col gap-3 text-[13.5px] text-fg-muted">
          {request.details && request.details.length > 0 && (
            <ul className="rounded-md border border-line bg-surface-2 px-3 py-2 text-fg">
              {request.details.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          )}
          {request.body && <div>{request.body}</div>}
          {request.warning && (
            <p
              role="note"
              className="rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-fg"
            >
              <span aria-hidden="true">⚠︎ </span>
              {request.warning}
            </p>
          )}
        </div>

        {request.choices && request.choices.length > 0 && (
          <fieldset className="mt-4 flex max-h-[45vh] flex-col gap-2 overflow-y-auto">
            <legend className="sr-only">{request.title}</legend>
            {request.choices.map((option) => (
              <label
                key={option.value}
                className={[
                  "flex cursor-pointer items-start gap-2.5 rounded-md border px-3 py-2 text-[13.5px] transition-colors",
                  choice === option.value
                    ? "border-accent bg-surface-2 text-fg"
                    : "border-line text-fg hover:bg-surface-2",
                ].join(" ")}
              >
                <input
                  type="radio"
                  name="confirm-choice"
                  value={option.value}
                  checked={choice === option.value}
                  onChange={() => setChoice(option.value)}
                  className="mt-1 accent-[var(--accent)]"
                />
                <span>
                  <span className="block font-medium">{option.label}</span>
                  {option.description && (
                    <span className="mt-0.5 block text-[12.5px] text-fg-muted">
                      {option.description}
                    </span>
                  )}
                </span>
              </label>
            ))}
          </fieldset>
        )}

        {request.reason && (
          <div className="mt-4">
            <label htmlFor={reasonId} className="block text-[12.5px] font-medium text-fg-muted">
              {request.reason.label}
              {request.reason.required ? " *" : ""}
            </label>
            <textarea
              id={reasonId}
              ref={reasonRef}
              rows={2}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              placeholder={request.reason.placeholder}
              className="mt-1.5 w-full rounded-md border border-line-strong bg-bg px-3 py-2 text-[14px] text-fg outline-none placeholder:text-fg-faint focus:border-accent"
            />
          </div>
        )}

        {request.typeToConfirm && (
          <div className="mt-4">
            <label htmlFor={typedId} className="block text-[12.5px] font-medium text-fg-muted">
              Pour confirmer, tapez{" "}
              <span className="font-mono text-fg">{request.typeToConfirm}</span>
            </label>
            <input
              id={typedId}
              ref={typedRef}
              value={typed}
              autoComplete="off"
              spellCheck={false}
              onChange={(event) => setTyped(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  submit();
                }
              }}
              className="mt-1.5 w-full rounded-md border border-line-strong bg-bg px-3 py-2 font-mono text-[14px] text-fg outline-none focus:border-accent"
            />
          </div>
        )}

        <div className="mt-5 flex justify-end gap-2">
          <button ref={cancelRef} type="button" className={btnCancel} onClick={() => onClose(null)}>
            {request.cancelLabel ?? "Annuler"}
          </button>
          <button
            ref={confirmRef}
            type="button"
            className={btnConfirm[tone]}
            disabled={reasonMissing || choiceMissing || typedMissing}
            onClick={submit}
          >
            {request.confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
