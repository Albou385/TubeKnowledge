import { NextRequest, NextResponse } from "next/server";

import { assertSameOrigin } from "@/lib/imports/http";
import { getVideoQueueEngine } from "@/lib/video-queue/engine";
import { publicVideoQueueError } from "@/lib/video-queue/errors";

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    assertSameOrigin(request);
    return NextResponse.json({ queue: await getVideoQueueEngine().retry((await params).id, await request.json()) });
  } catch (error) { return NextResponse.json({ error: publicVideoQueueError(error, "INVALID_REQUEST") }, { status: 400 }); }
}

