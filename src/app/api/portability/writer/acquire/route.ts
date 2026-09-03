import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { parseLibraryConfig } from "@/lib/config/library-config";
import { assertSameOrigin } from "@/lib/imports/http";
import { latestCheckpoint } from "@/lib/portability/checkpoints";
import { getPortabilityConfig } from "@/lib/portability/config";
import { portabilityApiError } from "@/lib/portability/http";
import { loadMachineIdentity } from "@/lib/portability/machine-identity";
import { acquireWriterAuthority } from "@/lib/portability/writer-authority";
import { consumeAcceptedHandoff, listHandoffs } from "@/lib/portability/handoff";
import { listExtendedAbsenceHandoffs } from "@/lib/portability/travel-handoff";
import { PortabilityError } from "@/lib/portability/errors";
const schema = z.object({ force: z.boolean().default(false) }).strict();
export async function POST(request: NextRequest) {
  try {
    assertSameOrigin(request);
    const input = schema.parse(await request.json());
    if (input.force) throw new PortabilityError("WRITER_REACQUIRE_CONFIRMATION_REQUIRED");
    const config = getPortabilityConfig();
    const library = parseLibraryConfig();
    const identity = await loadMachineIdentity(config);
    if (!library.ok || !identity) throw new PortabilityError("PORTABILITY_NOT_CONFIGURED");
    const checkpoint = await latestCheckpoint(library.rootPath);
    if (!checkpoint) throw new PortabilityError("WRITER_UNINITIALIZED");
    const extended = await listExtendedAbsenceHandoffs(library.rootPath);
    if (extended.some((handoff) => handoff.status === "prepared")) throw new PortabilityError("HANDOFF_REQUIRED");
    const accepted = (await listHandoffs(library.rootPath)).find((handoff) => handoff.status === "accepted" && handoff.targetMachineId === identity.machineId && handoff.checkpointId === checkpoint.checkpointId);
    if (!accepted) throw new PortabilityError("HANDOFF_REQUIRED");
    const authority = await acquireWriterAuthority(library.rootPath, identity, checkpoint, config.writerLeaseMinutes, {
      releasedAuthorityTransfer: { sourceMachineId: accepted.sourceMachineId, targetMachineId: identity.machineId, checkpointId: accepted.checkpointId },
    });
    await consumeAcceptedHandoff(library.rootPath, accepted.handoffId, identity);
    return NextResponse.json({ authority });
  } catch (error) { return portabilityApiError(error, 409); }
}

