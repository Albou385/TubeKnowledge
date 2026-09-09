import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { answerLibraryQuestion } from "../src/lib/library-assistant/assistant";
import { RETRIEVAL_BENCHMARK_CASES, SYNTHETIC_BENCHMARK_DOCUMENTS } from "../src/lib/library-assistant/retrieval-benchmark";

async function createFixture(root: string) {
  await writeFile(path.join(root, "INDEX.md"), "# Bibliothèque synthétique\n\nNavigation de la fixture seulement.\n", "utf8");
  for (const document of SYNTHETIC_BENCHMARK_DOCUMENTS) {
    const target = path.join(root, ...document.relativePath.split("/"));
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, document.content, "utf8");
  }
}

async function run() {
  const root = await mkdtemp(path.join(os.tmpdir(), "tk-retrieval-benchmark-"));
  try {
    await createFixture(root);
    let passed = 0;
    for (const item of RETRIEVAL_BENCHMARK_CASES) {
      const answer = await answerLibraryQuestion({ question: item.question, provider: "extractive", limit: 12 }, { YOUTUBE_LIBRARY_PATH: root });
      const citation = answer.citations.find((candidate) => candidate.relativePath === item.expectedPath);
      const top = answer.citations[0];
      const ok = top?.relativePath === item.expectedPath
        && citation?.anchor === item.expectedAnchor
        && citation.lineStart >= 1
        && (!item.rejectIndexAsTop || !/(^|\/)INDEX\.md$/.test(top.relativePath))
        && (!item.requireMultipleSources || answer.documentsUsed.length >= 2);
      if (ok) passed += 1;
      console.log(`${ok ? "PASS" : "FAIL"} ${item.id}`);
    }
    console.log(`Benchmark retrieval: ${passed}/${RETRIEVAL_BENCHMARK_CASES.length} PASS`);
    if (passed !== RETRIEVAL_BENCHMARK_CASES.length) process.exitCode = 1;
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

void run();
