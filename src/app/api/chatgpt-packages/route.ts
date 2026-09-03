import { NextRequest, NextResponse } from "next/server";

import { buildPackagePlan, generatePackage } from "@/lib/chatgpt-packages/builder";
import { safePackageError } from "@/lib/chatgpt-packages/http";
import { listStoredPackages } from "@/lib/chatgpt-packages/runtime";
import { packageRequestSchema } from "@/lib/chatgpt-packages/schema";
import { assertSameOrigin } from "@/lib/imports/http";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const packages = (await listStoredPackages()).map(({ manifest, status, preview }) => ({ manifest, status, estimates: preview.estimates }));
    return NextResponse.json({ packages });
  } catch (error) { return NextResponse.json({ error: safePackageError(error) }, { status: 400 }); }
}

export async function POST(request: NextRequest) {
  try {
    assertSameOrigin(request);
    const input = packageRequestSchema.parse(await request.json());
    if (input.action === "preview") {
      const plan = await buildPackagePlan(input);
      return NextResponse.json({ preview: plan.preview });
    }
    const packageRecord = await generatePackage(input);
    return NextResponse.json({ package: packageRecord }, { status: 201 });
  } catch (error) { return NextResponse.json({ error: safePackageError(error) }, { status: 400 }); }
}
