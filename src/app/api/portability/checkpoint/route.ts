import { NextRequest } from "next/server";

import { assertSameOrigin } from "@/lib/imports/http";
import { PortabilityError } from "@/lib/portability/errors";
import { portabilityApiError } from "@/lib/portability/http";

export async function POST(request: NextRequest) {
  try {
    assertSameOrigin(request);
    throw new PortabilityError("BOOTSTRAP_ROUTE_REQUIRED");
  } catch (error) {
    return portabilityApiError(error, 409);
  }
}
