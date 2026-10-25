import { beforeEach, describe, expect, it } from "vitest";
import { lastOrigin, useUIStore } from "./ui-store";

const initial = useUIStore.getState();
const ui = () => useUIStore.getState();

describe("navigation entre écrans", () => {
  beforeEach(() => useUIStore.setState(initial, true));

  it("retient la zone à montrer en ouvrant une séance", () => {
    ui().openSession("s-1", "documents");
    expect(ui().sessionIntent).toEqual({ kind: "open", sessionId: "s-1", focus: "documents" });
  });

  it("ouvre un lot depuis l'accueil puis y revient", () => {
    ui().openLot("lot-1");
    expect(ui()).toMatchObject({ page: "products", lotIntent: "lot-1" });
    expect(lastOrigin(ui())).toEqual({ page: "dashboard", detail: null });
    expect(ui().takeLotIntent()).toBe("lot-1");
    expect(ui().lotIntent).toBeNull();

    ui().goBack();
    expect(ui()).toMatchObject({ page: "dashboard", history: [] });
  });

  it("revient sur la fiche séance d'où l'on est parti", () => {
    ui().openSession("s-1");
    ui().takeSessionIntent();
    ui().setDetail({ kind: "session", id: "s-1" });

    ui().openClient("c-1");
    expect(lastOrigin(ui())).toEqual({
      page: "sessions",
      detail: { kind: "session", id: "s-1" },
    });

    ui().goBack();
    expect(ui()).toMatchObject({
      page: "sessions",
      sessionIntent: { kind: "open", sessionId: "s-1" },
    });
  });

  it("remonte plusieurs niveaux, jusqu'à l'écran de départ", () => {
    // Accueil → séance s-1 → client c-1 → séance s-2 → lot l-1
    ui().openSession("s-1");
    ui().takeSessionIntent();
    ui().setDetail({ kind: "session", id: "s-1" });
    ui().openClient("c-1");
    ui().takeClientIntent();
    ui().setDetail({ kind: "client", id: "c-1" });
    ui().openSession("s-2");
    ui().takeSessionIntent();
    ui().setDetail({ kind: "session", id: "s-2" });
    ui().openLot("l-1");
    ui().takeLotIntent();
    expect(ui().history).toHaveLength(4);

    ui().goBack();
    expect(ui()).toMatchObject({ page: "sessions", sessionIntent: { sessionId: "s-2" } });
    ui().takeSessionIntent();
    ui().setDetail({ kind: "session", id: "s-2" });

    ui().goBack();
    expect(ui()).toMatchObject({ page: "clients", clientIntent: "c-1" });
    ui().takeClientIntent();
    ui().setDetail({ kind: "client", id: "c-1" });

    ui().goBack();
    expect(ui()).toMatchObject({ page: "sessions", sessionIntent: { sessionId: "s-1" } });
    ui().takeSessionIntent();
    ui().setDetail({ kind: "session", id: "s-1" });

    ui().goBack();
    expect(ui()).toMatchObject({ page: "dashboard", history: [], detail: null });
  });

  it("ne garde pas une fiche quittée comme fiche courante", () => {
    ui().openClient("c-1");
    ui().takeClientIntent();
    ui().setDetail({ kind: "client", id: "c-1" });
    ui().goBack();
    // L'accueil n'a pas de fiche : ouvrir un lot depuis lui ne doit pas rouvrir le client.
    ui().openLot("l-1");
    expect(lastOrigin(ui())).toEqual({ page: "dashboard", detail: null });
  });

  it("depuis une liste du même écran, rien n'est retenu", () => {
    ui().setPage("sessions");
    ui().openSession("s-1");
    expect(ui().history).toEqual([]);
  });

  it("le menu repart de la liste et oublie les écrans d'origine", () => {
    ui().openLot("lot-1");
    ui().setPage("clients");
    expect(ui()).toMatchObject({ page: "clients", history: [], detail: null });
  });

  it("ne retient que les 20 derniers retours", () => {
    for (let index = 0; index < 30; index += 1) {
      ui().openSession(`s-${index}`);
      ui().setDetail({ kind: "session", id: `s-${index}` });
      ui().openClient(`c-${index}`);
      ui().setDetail({ kind: "client", id: `c-${index}` });
    }
    expect(ui().history).toHaveLength(20);
    expect(lastOrigin(ui())).toEqual({ page: "sessions", detail: { kind: "session", id: "s-29" } });
  });
});
