import { beforeEach, describe, expect, it } from "vitest";
import { useUIStore } from "./ui-store";

const initial = useUIStore.getState();

describe("navigation entre écrans", () => {
  beforeEach(() => useUIStore.setState(initial, true));

  it("ouvre un lot depuis l'accueil puis y revient", () => {
    const ui = useUIStore.getState();
    ui.openLot("lot-1");
    expect(useUIStore.getState()).toMatchObject({
      page: "products",
      lotIntent: "lot-1",
      origin: { page: "dashboard", detail: null },
    });
    expect(useUIStore.getState().takeLotIntent()).toBe("lot-1");
    expect(useUIStore.getState().lotIntent).toBeNull();

    useUIStore.getState().goBack();
    expect(useUIStore.getState()).toMatchObject({ page: "dashboard", origin: null });
  });

  it("revient sur la fiche séance d'où l'on est parti", () => {
    useUIStore.getState().openSession("s-1");
    useUIStore.getState().takeSessionIntent();
    useUIStore.getState().setDetail({ kind: "session", id: "s-1" });

    useUIStore.getState().openClient("c-1");
    expect(useUIStore.getState().origin).toEqual({
      page: "sessions",
      detail: { kind: "session", id: "s-1" },
    });

    useUIStore.getState().goBack();
    expect(useUIStore.getState()).toMatchObject({
      page: "sessions",
      sessionIntent: { kind: "open", sessionId: "s-1" },
    });
  });

  it("le menu repart de la liste et oublie l'écran d'origine", () => {
    useUIStore.getState().openLot("lot-1");
    useUIStore.getState().setPage("clients");
    expect(useUIStore.getState()).toMatchObject({ page: "clients", origin: null, detail: null });
  });
});
