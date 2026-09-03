import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ preview: vi.fn(), apply: vi.fn(), discover: vi.fn(), resume: vi.fn() }));

vi.mock("@/lib/portability/writer-disaster-recovery", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/portability/writer-disaster-recovery")>();
  return {
    ...actual,
    previewWriterDisasterRecovery: mocks.preview,
    applyWriterDisasterRecovery: mocks.apply,
    discoverPendingWriterDisasterRecovery: mocks.discover,
    resumePendingWriterDisasterRecovery: mocks.resume,
  };
});

function request(url: string, body: unknown, headers: Record<string, string> = {}): NextRequest {
  return new NextRequest(url, {
    method: "POST",
    headers: { "content-type": "application/json", origin: "http://localhost", host: "localhost", ...headers },
    body: JSON.stringify(body),
  });
}

describe("routes de récupération d’urgence writer", () => {
  beforeEach(() => {
    mocks.preview.mockReset();
    mocks.apply.mockReset();
    mocks.discover.mockReset();
    mocks.resume.mockReset();
  });

  it("expose uniquement des mutations POST et une Preview séparée", async () => {
    const previewRoute = await import("./preview/route");
    const applyRoute = await import("./apply/route");
    expect((previewRoute as Record<string, unknown>).GET).toBeUndefined();
    expect((applyRoute as Record<string, unknown>).GET).toBeUndefined();
    mocks.preview.mockResolvedValue({ recoveryId: "33333333-3333-4333-8333-333333333333", status: "ready", risks: ["Risque"] });

    const response = await previewRoute.POST(request("http://localhost/api/portability/writer/disaster-recovery/preview", { backupId: "22222222-2222-4222-8222-222222222222" }));
    expect(response.status).toBe(200);
    expect(mocks.preview).toHaveBeenCalledWith({ backupId: "22222222-2222-4222-8222-222222222222" });
  });

  it("exige confirmation exacte et clé d’idempotence pour Apply", async () => {
    const { POST } = await import("./apply/route");
    const missingKey = await POST(request("http://localhost/api/portability/writer/disaster-recovery/apply", {
      recoveryId: "33333333-3333-4333-8333-333333333333",
      confirmationText: "REPRENDRE LE WRITER SUR CE PORTABLE",
    }));
    expect(missingKey.status).toBe(409);
    expect(await missingKey.json()).toMatchObject({ error: { code: "IDEMPOTENCY_KEY_INVALID" } });

    const wrongConfirmation = await POST(request("http://localhost/api/portability/writer/disaster-recovery/apply", {
      recoveryId: "33333333-3333-4333-8333-333333333333",
      confirmationText: "REPRENDRE",
    }, { "Idempotency-Key": "44444444-4444-4444-8444-444444444444" }));
    expect(wrongConfirmation.status).toBe(409);
    expect(mocks.apply).not.toHaveBeenCalled();
  });

  it("refuse une origine différente avant le service", async () => {
    const { POST } = await import("./preview/route");
    const response = await POST(request("http://localhost/api/portability/writer/disaster-recovery/preview", {
      backupId: "22222222-2222-4222-8222-222222222222",
    }, { origin: "https://example.invalid" }));
    expect(response.status).toBe(409);
    expect(mocks.preview).not.toHaveBeenCalled();
  });

  it("découvre par GET read-only puis reprend uniquement par POST", async () => {
    const pendingRoute = await import("./pending/route");
    const resumeRoute = await import("./resume/route");
    expect((pendingRoute as Record<string, unknown>).POST).toBeUndefined();
    expect((resumeRoute as Record<string, unknown>).GET).toBeUndefined();
    mocks.discover.mockResolvedValue({ recoveryId: "33333333-3333-4333-8333-333333333333", startedAt: "2026-09-02T00:31:00.000Z" });
    const pendingResponse = await pendingRoute.GET();
    expect(pendingResponse.status).toBe(200);
    expect(mocks.resume).not.toHaveBeenCalled();

    mocks.resume.mockResolvedValue({ operation: "disaster-recovery" });
    const resumeResponse = await resumeRoute.POST(request("http://localhost/api/portability/writer/disaster-recovery/resume", {
      recoveryId: "33333333-3333-4333-8333-333333333333",
      confirmationText: "REPRENDRE LE WRITER SUR CE PORTABLE",
    }));
    expect(resumeResponse.status).toBe(200);
    expect(mocks.resume).toHaveBeenCalledWith({
      recoveryId: "33333333-3333-4333-8333-333333333333",
      confirmationText: "REPRENDRE LE WRITER SUR CE PORTABLE",
    });
  });
});
