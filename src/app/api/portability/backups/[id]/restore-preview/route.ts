import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { parseLibraryConfig } from "@/lib/config/library-config";
import { assertSameOrigin } from "@/lib/imports/http";
import { getPortabilityConfig } from "@/lib/portability/config";
import { portabilityApiError } from "@/lib/portability/http";
import { previewRestore } from "@/lib/portability/restore-preview";
const schema = z.object({ mode: z.enum(["restore-to-staging", "restore-in-place"]), stagingPath: z.string().optional(), mirror: z.boolean().default(false) }).strict();
export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) { try { assertSameOrigin(request); const input = schema.parse(await request.json()); const { id } = await context.params; const config = getPortabilityConfig(); const library = parseLibraryConfig(); if (!library.ok) throw new Error(library.message); const targetRoot = input.mode === "restore-in-place" ? library.rootPath : input.stagingPath; if (!targetRoot) throw new Error("La destination staging explicite est requise."); const preview = await previewRestore(config, { backupId: id, mode: input.mode, targetRoot, mirror: input.mirror }); return NextResponse.json({ preview }); } catch (error) { return portabilityApiError(error); } }

