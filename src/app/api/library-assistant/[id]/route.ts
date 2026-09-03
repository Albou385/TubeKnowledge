import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { assertSameOrigin } from "@/lib/imports/http";
import { deleteAssistantHistory } from "@/lib/library-assistant/history";

const schema = z.object({ confirmed: z.literal(true) }).strict();

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try { assertSameOrigin(request); schema.parse(await request.json()); await deleteAssistantHistory((await params).id, true); return new NextResponse(null, { status: 204 }); }
  catch { return NextResponse.json({ error: { code: "DELETE_FAILED", message: "La suppression de cet élément d’historique a échoué." } }, { status: 400 }); }
}
