import { MIN_PASSWORD_CHARS } from "../../stores/security-store";

export type NewPassword = { password: string; confirmation: string };

/** Problème à corriger avant d'envoyer, ou `null` si le nouveau mot de passe convient. */
export function newPasswordProblem({ password, confirmation }: NewPassword): string | null {
  if ([...password].length < MIN_PASSWORD_CHARS) {
    return `Le mot de passe doit compter au moins ${MIN_PASSWORD_CHARS} caractères.`;
  }
  if (password.trim() === "") return "Le mot de passe ne peut pas être fait que d’espaces.";
  if (password !== confirmation) return "Les deux mots de passe ne sont pas identiques.";
  return null;
}

export const EMPTY_PASSWORD: NewPassword = { password: "", confirmation: "" };
