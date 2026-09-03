import { NextRequest, NextResponse } from "next/server";

import { publicResultUploadError } from "@/lib/chatgpt-packages/result-errors";
import { prevalidateChatGptResult } from "@/lib/chatgpt-packages/result";
import { assertSameOrigin } from "@/lib/imports/http";

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    assertSameOrigin(request);
    const form = await request.formData();
    const file = form.get("result");
    if (!(file instanceof File)) throw new Error("Sélectionnez un ZIP de résultat.");
    const result = await prevalidateChatGptResult((await params).id, Buffer.from(await file.arrayBuffer()));
    return NextResponse.json({ result });
  } catch (error) { return NextResponse.json({ error: publicResultUploadError(error) }, { status: 400 }); }
}
