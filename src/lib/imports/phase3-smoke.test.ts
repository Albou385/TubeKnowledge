import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { applyImport } from "@/lib/imports/apply";
import { readImportHistory } from "@/lib/imports/history";
import { sha256 } from "@/lib/imports/hash";
import { previewImport } from "@/lib/imports/preview";
import { makeVault, packageZip, validManifest } from "@/lib/imports/test-utils";

describe("fumée Phase 3 sur vault temporaire", () => {
it("valide preview, diff, apply, backup, historique, conflit et rollback", async () => {
  const rootPath = await mkdtemp(path.join(os.tmpdir(), "tk-phase3-smoke-vault-"));
  const sessionRoot = await mkdtemp(path.join(os.tmpdir(), "tk-phase3-smoke-sessions-"));
  const environment = { YOUTUBE_LIBRARY_PATH: rootPath };

  try {
  await makeVault(rootPath);
  const preview = await previewImport(await packageZip(), { environment, sessionRoot });
  const applied = await applyImport({ sessionId: preview.sessionId, confirmed: true }, { environment, sessionRoot });
  const backupPresent = Boolean(applied.backupId && await stat(path.join(rootPath, ".backups", "imports", applied.backupId, "backup-manifest.json")));
  const history = await readImportHistory(rootPath);

  const conflictContent = "# Conflit\n";
  const conflictManifest = validManifest({ operations: [{ type: "create", path: "01_BIBLIOTHEQUE/Test/conflit.md", contentFile: "changes/create/01_BIBLIOTHEQUE/Test/conflit.md", expectedState: "absent", newSha256: sha256("# Nouvelle notion\n\nContenu sûr.\n") }] });
  const conflictPreview = await previewImport(await packageZip(conflictManifest), { environment, sessionRoot });
  await mkdir(path.join(rootPath, "01_BIBLIOTHEQUE", "Test"), { recursive: true });
  await writeFile(path.join(rootPath, "01_BIBLIOTHEQUE", "Test", "conflit.md"), conflictContent, "utf8");
  const conflict = await applyImport({ sessionId: conflictPreview.sessionId, confirmed: true }, { environment, sessionRoot });

  const rollbackManifest = validManifest({ operations: [{ type: "create", path: "01_BIBLIOTHEQUE/Test/rollback.md", contentFile: "changes/create/01_BIBLIOTHEQUE/Test/rollback.md", expectedState: "absent", newSha256: sha256("# Nouvelle notion\n\nContenu sûr.\n") }] });
  const rollbackPreview = await previewImport(await packageZip(rollbackManifest), { environment, sessionRoot });
  const rollback = await applyImport({ sessionId: rollbackPreview.sessionId, confirmed: true }, { environment, sessionRoot, failAfterOperations: 1 });
  let rollbackTargetAbsent = false;
  try { await readFile(path.join(rootPath, "01_BIBLIOTHEQUE", "Test", "rollback.md")); } catch { rollbackTargetAbsent = true; }

    expect({ preview: preview.canApply, diffPresent: preview.operations[0].diff.lines.length > 0, apply: applied.status, backupPresent, historyEntries: history.length, conflict: conflict.status, conflictPreserved: await readFile(path.join(rootPath, "01_BIBLIOTHEQUE", "Test", "conflit.md"), "utf8") === conflictContent, rollback: rollback.status, rollbackTargetAbsent }).toEqual({ preview: true, diffPresent: true, apply: "success", backupPresent: true, historyEntries: 1, conflict: "conflict", conflictPreserved: true, rollback: "rolled-back", rollbackTargetAbsent: true });
  } finally {
    await rm(rootPath, { recursive: true, force: true });
    await rm(sessionRoot, { recursive: true, force: true });
  }
});
});
