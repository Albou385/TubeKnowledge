import { NextResponse } from "next/server";

import { PortabilityError, publicPortabilityError } from "./errors";

export function portabilityApiError(error: unknown, status = 400): NextResponse {
  if (error instanceof PortabilityError) return NextResponse.json({ error: publicPortabilityError(error) }, { status });
  console.error("Portability operation failed", error);
  return NextResponse.json({ error: publicPortabilityError(new PortabilityError("VAULT_UNAVAILABLE")) }, { status });
}

