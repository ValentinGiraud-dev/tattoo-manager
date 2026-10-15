import { useId } from "react";
import { fieldClass, labelClass } from "../../components/styles";
import { MIN_PASSWORD_CHARS } from "../../stores/security-store";
import type { NewPassword } from "./password-rules";

/** Nouveau mot de passe + confirmation. Les erreurs ne s'affichent qu'une fois `showErrors`. */
export function NewPasswordFields({
  value,
  onChange,
  showErrors,
  autoFocus = false,
  label = "Nouveau mot de passe",
}: {
  value: NewPassword;
  onChange: (value: NewPassword) => void;
  showErrors: boolean;
  autoFocus?: boolean;
  label?: string;
}) {
  const hintId = useId();
  const length = [...value.password].length;
  const mismatch = showErrors && value.confirmation !== "" && value.password !== value.confirmation;

  return (
    <>
      <label className={labelClass}>
        {label}
        <input
          type="password"
          autoComplete="new-password"
          autoFocus={autoFocus}
          value={value.password}
          onChange={(event) => onChange({ ...value, password: event.target.value })}
          aria-describedby={hintId}
          className={fieldClass}
        />
        <span
          id={hintId}
          className={[
            "mt-1 block text-[12px] font-normal",
            showErrors && length < MIN_PASSWORD_CHARS ? "text-danger" : "text-fg-faint",
          ].join(" ")}
        >
          Au moins {MIN_PASSWORD_CHARS} caractères
          {length > 0 ? ` · ${length} saisi${length > 1 ? "s" : ""}` : ""}. Une phrase courte est
          plus facile à retenir et plus solide.
        </span>
      </label>
      <label className={labelClass}>
        Confirmer le mot de passe
        <input
          type="password"
          autoComplete="new-password"
          value={value.confirmation}
          onChange={(event) => onChange({ ...value, confirmation: event.target.value })}
          aria-invalid={mismatch || undefined}
          className={fieldClass}
        />
        {mismatch && (
          <span className="mt-1 block text-[12px] font-normal text-danger">
            Les deux mots de passe ne sont pas identiques.
          </span>
        )}
      </label>
    </>
  );
}
