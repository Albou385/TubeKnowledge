import type { NextRequest } from "next/server";

export function assertSameOrigin(request: NextRequest): void {
  const origin = request.headers.get("origin");
  if (!origin) return;
  const host = request.headers.get("host");
  if (!host || new URL(origin).host !== host) throw new Error("Origine de requête refusée.");
}
