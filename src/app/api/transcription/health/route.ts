import { NextResponse } from "next/server";

import { inspectTranscriptionHealth } from "@/lib/transcription/health";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json(await inspectTranscriptionHealth(), { status: 200 });
}

