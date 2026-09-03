import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const root = path.join(os.tmpdir(), "tubeknowledge-expired-local-conflict-qa");

test("expiration locale, divergence légitime, confirmation et persistance via les vrais boutons", async ({ page, request }) => {
  const fixture = JSON.parse(await readFile(path.join(root, "fixture.json"), "utf8")) as { vault: string; statePath: string; conflictId: string };
  const target = path.join(fixture.vault, "02_SOURCES", "videos.md");
  const before = await readFile(target, "utf8");
  await page.goto(`/portability/conflicts/${fixture.conflictId}`, { waitUntil: "networkidle" });
  await expect(page.getByRole("heading", { name: "Divergence de contenu" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Conserver le contenu actuel et réactiver l’écriture" })).toBeVisible();
  await page.locator("select[name=backupId]").selectOption({ index: 1 });
  await page.getByLabel(/Saisir exactement CONSERVER ET REACQUERIR/i).fill("CONSERVER ET REACQUERIR");
  await page.getByRole("button", { name: "Conserver et réactiver l’écriture" }).click();
  await expect(page.getByRole("status")).toContainText("Le contenu actuel devient la nouvelle référence");
  expect(await readFile(target, "utf8")).toBe(before);

  await page.goto("/portability", { waitUntil: "networkidle" });
  await expect(page.getByText("Écriture autorisée sur cette machine")).toBeVisible();
  const status = await request.get("/api/portability/status");
  expect(status.status()).toBe(200);
  await expect(status.json()).resolves.toMatchObject({ status: { writer: { state: "active-local", canWrite: true }, conflicts: { open: 0 } } });
  const persisted = JSON.parse(await readFile(path.join(fixture.statePath, "conflicts.json"), "utf8"));
  expect(persisted).toEqual([expect.objectContaining({ conflictId: fixture.conflictId, status: "resolved" })]);
  await page.reload({ waitUntil: "networkidle" });
  await expect(page.getByText("Écriture autorisée sur cette machine")).toBeVisible();
});
