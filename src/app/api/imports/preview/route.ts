import { NextRequest, NextResponse } from "next/server";

import { IMPORT_LIMITS } from "@/lib/imports/constants";
import { assertSameOrigin } from "@/lib/imports/http";
import { previewImport } from "@/lib/imports/preview";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    assertSameOrigin(request);
    const form = await request.formData();
    const file = form.get("package");
    if (!(file instanceof File) || file.size === 0) return NextResponse.json({ error: "Sélectionnez un paquet ZIP." }, { status: 400 });
    if (file.size > IMPORT_LIMITS.maxZipBytes) return NextResponse.json({ error: "Le ZIP dépasse 10 MiB." }, { status: 413 });
    const preview = await previewImport(Buffer.from(await file.arrayBuffer()));
    return NextResponse.json({ preview }, { status: 200 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Paquet invalide." }, { status: 400 });
  }
}
