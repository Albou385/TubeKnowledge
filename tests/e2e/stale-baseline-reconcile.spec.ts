import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const root = path.join(os.tmpdir(), "tubeknowledge-stale-baseline-qa");
test("baseline périmée et checkpoint courant: réconciliation réelle sur fixture temporaire", async ({ page, request }) => {
  const fixture = JSON.parse(await readFile(path.join(root, "fixture.json"), "utf8")) as { vault: string; statePath: string; conflictId: string; checkpointId: string };
  const target = path.join(fixture.vault, "02_SOURCES", "videos.md"); const before = await readFile(target);
  await page.goto(`/portability/conflicts/${fixture.conflictId}`, { waitUntil: "networkidle" });
  await expect(page.getByRole("heading", { name: "Réconcilier l’état local et réactiver l’écriture" })).toBeVisible();
  await page.locator("select[name=backupId]").selectOption({ index: 1 }); await page.getByLabel(/Saisir exactement RECONCILIER ET REACQUERIR/i).fill("RECONCILIER ET REACQUERIR");
  await page.getByRole("button", { name: "Réconcilier l’état local et réactiver l’écriture" }).click();
  await expect(page.getByRole("status")).toContainText("réconciliée avec le checkpoint existant"); expect(await readFile(target)).toEqual(before);
  const status = await request.get("/api/portability/status"); await expect(status.json()).resolves.toMatchObject({ status: { writer: { state: "active-local", canWrite: true }, conflicts: { open: 0 }, checkpoint: { checkpointId: fixture.checkpointId } } });
  expect(JSON.parse(await readFile(path.join(fixture.statePath, "conflicts.json"), "utf8"))).toEqual([expect.objectContaining({ conflictId: fixture.conflictId, status: "resolved" })]);
});
