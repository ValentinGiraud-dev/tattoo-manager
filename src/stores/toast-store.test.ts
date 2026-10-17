import { describe, expect, it } from "vitest";
import { toast, useToastStore } from "./toast-store";

describe("toasts", () => {
  it("garde les trois plus récents", () => {
    for (const message of ["un", "deux", "trois", "quatre"]) toast.success(message);
    const messages = useToastStore.getState().toasts.map((item) => item.message);
    expect(messages).toEqual(["deux", "trois", "quatre"]);
  });

  it("se ferme à la demande", () => {
    const [first] = useToastStore.getState().toasts;
    useToastStore.getState().dismiss(first.id);
    expect(useToastStore.getState().toasts.some((item) => item.id === first.id)).toBe(false);
  });
});
