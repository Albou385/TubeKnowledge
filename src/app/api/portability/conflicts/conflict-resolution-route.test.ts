import { readFile } from "node:fs/promises";
import path from "node:path";
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const resolveCurrentConflict = vi.fn();
const acknowledgeLegacyWriterConflict = vi.fn();
const keepCurrentAndReacquireExpiredLocalWriter = vi.fn();
const reconcileStaleBaselineAndReacquireWriter = vi.fn();
vi.mock("@/lib/portability/conflict-resolution", () => ({ resolveCurrentConflict }));
vi.mock("@/lib/portability/expired-local-conflict-reacquire", () => ({
  expiredLocalConflictReacquireRequestSchema: { parse: (value: unknown) => value },
  keepCurrentAndReacquireExpiredLocalWriter,
}));
vi.mock("@/lib/portability/stale-baseline-expired-writer-reconcile", () => ({
  staleBaselineReconcileRequestSchema: { parse: (value: unknown) => value },
  reconcileStaleBaselineAndReacquireWriter,
}));
vi.mock("@/lib/portability/legacy-writer-conflict", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/portability/legacy-writer-conflict")>();
  return { ...actual, acknowledgeLegacyWriterConflict };
});

describe("API et interface de résolution de conflit", () => {
  beforeEach(() => { resolveCurrentConflict.mockReset(); acknowledgeLegacyWriterConflict.mockReset(); keepCurrentAndReacquireExpiredLocalWriter.mockReset(); reconcileStaleBaselineAndReacquireWriter.mockReset(); });

  it("retourne une réponse keep-current bornée sans chemin, hash, secret ni identifiant interne", async () => {
    resolveCurrentConflict.mockResolvedValue({ conflict: { status: "resolved" }, idempotent: false, requiresPhase3Apply: false });
    const { POST } = await import("./[id]/resolve/route");
    const request = new NextRequest("http://localhost/api/portability/conflicts/22222222-2222-4222-8222-222222222222/resolve", { method: "POST", headers: { "content-type": "application/json", origin: "http://localhost", host: "localhost" }, body: JSON.stringify({ action: "keep-current", confirmed: true }) });
    const response = await POST(request, { params: Promise.resolve({ id: "22222222-2222-4222-8222-222222222222" }) }); const text = await response.text();
    expect(response.status).toBe(200); expect(text).toContain("Le contenu actuel a été conservé explicitement."); expect(text).toContain('"requiresPhase3Apply":false'); expect(text).not.toMatch(/[A-Z]:\\|22222222-2222|[a-f0-9]{64}|token|secret/i);
  });

  it("combine conservation et réacquisition seulement avec la confirmation et la clé d’idempotence", async () => {
    keepCurrentAndReacquireExpiredLocalWriter.mockResolvedValue({ conflict: { status: "resolved" } });
    const { POST } = await import("./[id]/resolve/route");
    const request = new NextRequest("http://localhost/api/portability/conflicts/22222222-2222-4222-8222-222222222222/resolve", {
      method: "POST", headers: { "content-type": "application/json", origin: "http://localhost", host: "localhost", "Idempotency-Key": "33333333-3333-4333-8333-333333333333" },
      body: JSON.stringify({ action: "keep-current-and-reacquire", backupId: "44444444-4444-4444-8444-444444444444", confirmationText: "CONSERVER ET REACQUERIR" }),
    });
    const response = await POST(request, { params: Promise.resolve({ id: "22222222-2222-4222-8222-222222222222" }) }); const text = await response.text();
    expect(response.status).toBe(200); expect(text).toContain("nouvelle référence"); expect(text).not.toMatch(/[A-Z]:\\|[a-f0-9]{64}|secret/i);
    expect(keepCurrentAndReacquireExpiredLocalWriter).toHaveBeenCalledWith({ conflictId: "22222222-2222-4222-8222-222222222222", backupId: "44444444-4444-4444-8444-444444444444", confirmationText: "CONSERVER ET REACQUERIR", idempotencyKey: "33333333-3333-4333-8333-333333333333" });
  });

  it("réconcilie la baseline par une route distincte, confirmée et idempotente", async () => {
    reconcileStaleBaselineAndReacquireWriter.mockResolvedValue({ resolvedConflictIds: ["22222222-2222-4222-8222-222222222222"] });
    const { POST } = await import("./[id]/reconcile-stale-baseline/route");
    const request = new NextRequest("http://localhost/api/portability/conflicts/22222222-2222-4222-8222-222222222222/reconcile-stale-baseline", { method: "POST", headers: { "content-type": "application/json", origin: "http://localhost", host: "localhost", "Idempotency-Key": "33333333-3333-4333-8333-333333333333" }, body: JSON.stringify({ backupId: "44444444-4444-4444-8444-444444444444", confirmationText: "RECONCILIER ET REACQUERIR" }) });
    const response = await POST(request, { params: Promise.resolve({ id: "22222222-2222-4222-8222-222222222222" }) }); const text = await response.text();
    expect(response.status).toBe(200); expect(text).toContain("checkpoint existant"); expect(text).not.toMatch(/[A-Z]:\\|[a-f0-9]{64}|secret/i);
    expect(reconcileStaleBaselineAndReacquireWriter).toHaveBeenCalledWith({ conflictId: "22222222-2222-4222-8222-222222222222", idempotencyKey: "33333333-3333-4333-8333-333333333333", backupId: "44444444-4444-4444-8444-444444444444", confirmationText: "RECONCILIER ET REACQUERIR" });
  });

  it("exige une confirmation humaine dans le composant et n’affiche pas les preuves internes complètes", async () => {
    const component = await readFile(path.join(process.cwd(), "src/components/conflict-resolution-actions.tsx"), "utf8"); const page = await readFile(path.join(process.cwd(), "src/app/portability/conflicts/[id]/page.tsx"), "utf8");
    expect(component).toContain("window.confirm"); expect(component).toContain("Conserver le contenu actuel"); expect(component).toContain("Classer comme faux positif"); expect(page).not.toContain("baseCheckpointId"); expect(page).not.toContain("evidence.hashes");
  });

  it("classe le seul conflit writer legacy par POST idempotent et confirmation exacte", async () => {
    acknowledgeLegacyWriterConflict.mockResolvedValue({ conflict: { status: "false-positive" }, idempotent: false });
    const { POST } = await import("./[id]/acknowledge-legacy-writer/route");
    const request = new NextRequest("http://localhost/api/portability/conflicts/22222222-2222-4222-8222-222222222222/acknowledge-legacy-writer", {
      method: "POST",
      headers: { "content-type": "application/json", origin: "http://localhost", host: "localhost", "Idempotency-Key": "33333333-3333-4333-8333-333333333333" },
      body: JSON.stringify({ confirmationText: "CLASSER LE CONFLIT WRITER HISTORIQUE" }),
    });
    const response = await POST(request, { params: Promise.resolve({ id: "22222222-2222-4222-8222-222222222222" }) });
    expect(response.status).toBe(200);
    expect(acknowledgeLegacyWriterConflict).toHaveBeenCalledWith({
      conflictId: "22222222-2222-4222-8222-222222222222",
      idempotencyKey: "33333333-3333-4333-8333-333333333333",
      confirmationText: "CLASSER LE CONFLIT WRITER HISTORIQUE",
    });
  });

  it("retourne l’erreur publique de conflit pour une confirmation legacy incorrecte", async () => {
    const { POST } = await import("./[id]/acknowledge-legacy-writer/route");
    const request = new NextRequest("http://localhost/api/portability/conflicts/22222222-2222-4222-8222-222222222222/acknowledge-legacy-writer", {
      method: "POST",
      headers: { "content-type": "application/json", origin: "http://localhost", host: "localhost", "Idempotency-Key": "33333333-3333-4333-8333-333333333333" },
      body: JSON.stringify({ confirmationText: "CLASSER" }),
    });
    const response = await POST(request, { params: Promise.resolve({ id: "22222222-2222-4222-8222-222222222222" }) });
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({ error: { code: "CONFLICT_ACTION_NOT_ALLOWED", message: "Cette action n’est pas autorisée pour ce conflit." } });
    expect(acknowledgeLegacyWriterConflict).not.toHaveBeenCalled();
  });
});
