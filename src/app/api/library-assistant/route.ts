import { NextRequest, NextResponse } from "next/server";

import { answerLibraryQuestion } from "@/lib/library-assistant/assistant";
import { listAssistantHistory, recordAssistantHistory } from "@/lib/library-assistant/history";
import { libraryQuestionSchema } from "@/lib/library-assistant/schema";
import { assertSameOrigin } from "@/lib/imports/http";

export const dynamic = "force-dynamic";

export async function GET() {
  try { return NextResponse.json({ history: await listAssistantHistory() }); }
  catch { return NextResponse.json({ error: { code: "HISTORY_UNAVAILABLE", message: "L’historique local est indisponible." } }, { status: 503 }); }
}

export async function POST(request: NextRequest) {
  try {
    assertSameOrigin(request);
    const answer = await answerLibraryQuestion(libraryQuestionSchema.parse(await request.json()));
    const history = await recordAssistantHistory(answer);
    return NextResponse.json({ answer, history });
  } catch { return NextResponse.json({ error: { code: "QUESTION_INVALID", message: "La question est invalide ou la bibliothèque est indisponible." } }, { status: 400 }); }
}
