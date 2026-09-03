import { NextRequest, NextResponse } from "next/server";
import { parseLibraryConfig } from "@/lib/config/library-config";
import { assertSameOrigin } from "@/lib/imports/http";
import { getPortabilityConfig } from "@/lib/portability/config";
import { portabilityApiError } from "@/lib/portability/http";
import { loadMachineIdentity } from "@/lib/portability/machine-identity";
import { releaseWriterAuthority } from "@/lib/portability/writer-authority";
export async function POST(request: NextRequest) { try { assertSameOrigin(request); const config = getPortabilityConfig(); const library = parseLibraryConfig(); const identity = await loadMachineIdentity(config); if (!library.ok || !identity) throw new Error("Configuration incomplète."); await releaseWriterAuthority(library.rootPath, identity); return NextResponse.json({ released: true }); } catch (error) { return portabilityApiError(error, 409); } }

