import { NextResponse } from "next/server";

import { inspectLibrary } from "@/lib/library/library-reader";

export const dynamic = "force-dynamic";

export async function GET() {
  const library = await inspectLibrary();

  return NextResponse.json(
    {
      status: "ok",
      schemaVersion: 1,
      configuration: library.configValid ? "valid" : "invalid",
      library: library.accessible ? "accessible" : "inaccessible",
      index: library.indexPresent ? "present" : "missing",
    },
    { status: 200 },
  );
}
