import { NextRequest, NextResponse } from "next/server";

import { assertSameOrigin } from "@/lib/imports/http";
import { getVideoQueueEngine } from "@/lib/video-queue/engine";
import { publicVideoQueueError, VideoQueueError } from "@/lib/video-queue/errors";

export const dynamic = "force-dynamic";

export async function GET() {
  try { return NextResponse.json({ queue: await getVideoQueueEngine().snapshot() }); }
  catch (error) { return NextResponse.json({ error: publicVideoQueueError(error) }, { status: 500 }); }
}

export async function POST(request: NextRequest) {
  try {
    assertSameOrigin(request);
    return NextResponse.json(await getVideoQueueEngine().add(await request.json()), { status: 201 });
  } catch (error) {
    const status = error instanceof VideoQueueError && error.code === "QUEUE_COMMAND_CONFLICT" ? 409 : 400;
    return NextResponse.json({ error: publicVideoQueueError(error, "INVALID_REQUEST") }, { status });
  }
}

