import { describe, expect, it } from "vitest";
import { newPasswordProblem } from "./password-rules";

describe("newPasswordProblem", () => {
  it("accepte un mot de passe de 8 caractères confirmé", () => {
    expect(newPasswordProblem({ password: "atelier1", confirmation: "atelier1" })).toBeNull();
  });

  it("compte les caractères, pas les octets", () => {
    expect(newPasswordProblem({ password: "éééééééé", confirmation: "éééééééé" })).toBeNull();
    expect(newPasswordProblem({ password: "ééééééé", confirmation: "ééééééé" })).toMatch(
      /au moins 8/,
    );
  });

  it("refuse les espaces seuls et une confirmation différente", () => {
    expect(newPasswordProblem({ password: "        ", confirmation: "        " })).toMatch(
      /espaces/,
    );
    expect(newPasswordProblem({ password: "atelier1", confirmation: "atelier2" })).toMatch(
      /identiques/,
    );
  });
});
