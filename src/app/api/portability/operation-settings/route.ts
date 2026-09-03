import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { assertSameOrigin } from "@/lib/imports/http";
import { getPortabilityConfig } from "@/lib/portability/config";
import { portabilityApiError } from "@/lib/portability/http";
import { saveOperationSettings } from "@/lib/portability/operation-settings";

const schema = z.object({
  singleMachineMode: z.boolean(),
  renewalReminderMinutes: z.number().int().min(1).max(1440),
}).strict();

export async function POST(request: NextRequest) {
  try {
    assertSameOrigin(request);
    const settings = await saveOperationSettings(getPortabilityConfig(), schema.parse(await request.json()));
    return NextResponse.json({ settings });
  } catch (error) {
    return portabilityApiError(error);
  }
}
