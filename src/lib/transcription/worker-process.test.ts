import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { runWorkerProcess, safeStderrSummary } from "./worker-process";

const roots: string[] = [];
async function script(content: string) { const root = await mkdtemp(path.join(os.tmpdir(), "tk-worker-")); roots.push(root); const file = path.join(root, "worker.cjs"); await writeFile(file, content); return { root, file }; }
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }))); });

describe("processus worker", () => {
  it("collecte un protocole valide avec shell désactivé", async () => {
    const { root, file } = await script("console.log(JSON.stringify({type:'started',stage:'inspect'})); console.log(JSON.stringify({type:'completed',result:{ok:true}}));");
    const events: string[] = []; const runner = runWorkerProcess(process.execPath, [file], { cwd: root, timeoutMs: 2_000, onEvent: (event) => { events.push(event.type); } });
    await expect(runner.promise).resolves.toMatchObject({ result: { ok: true } }); expect(events).toEqual(["started", "completed"]);
  });

  it("refuse une sortie non JSONL", async () => {
    const { root, file } = await script("console.log('texte libre'); setInterval(()=>{},1000);");
    const runner = runWorkerProcess(process.execPath, [file], { cwd: root, timeoutMs: 2_000, onEvent: () => undefined });
    await expect(runner.promise).rejects.toMatchObject({ code: "WORKER_PROTOCOL_INVALID" });
  }, 15_000);

  it("gère timeout et annulation", async () => {
    const { root, file } = await script("console.log(JSON.stringify({type:'started',stage:'transcribing'})); setInterval(()=>{},1000);");
    const timeout = runWorkerProcess(process.execPath, [file], { cwd: root, timeoutMs: 50, onEvent: () => undefined });
    await expect(timeout.promise).rejects.toMatchObject({ code: "WORKER_TIMEOUT" });
    const canceled = runWorkerProcess(process.execPath, [file], { cwd: root, timeoutMs: 5_000, onEvent: () => undefined });
    const canceledExpectation = expect(canceled.promise).rejects.toThrow();
    await canceled.cancel(); await canceledExpectation;
  }, 15_000);

  it("classe un code non nul et ne réexpose jamais le stderr brut", async () => {
    const secret = "C:\\Users\\secret\\runtime token=hidden";
    const { root, file } = await script(`console.error(${JSON.stringify(`${secret} [SSL: CERTIFICATE_VERIFY_FAILED]`)}); process.exitCode=1;`);
    const runner = runWorkerProcess(process.execPath, [file], { cwd: root, timeoutMs: 2_000, onEvent: () => undefined });
    await expect(runner.promise).rejects.toMatchObject({ code: "YOUTUBE_ACCESS_FAILED" });
    const summary = safeStderrSummary(`${secret} [SSL: CERTIFICATE_VERIFY_FAILED]`);
    expect(summary).toContain("YOUTUBE_ACCESS_FAILED");
    expect(summary).not.toContain("Users\\secret");
    expect(summary).not.toContain("token=hidden");
  });
});
