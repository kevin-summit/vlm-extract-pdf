import { NextResponse } from "next/server";
import { getModels } from "@/lib/models";

export const dynamic = "force-dynamic";

export function GET() {
  const models = getModels();
  return NextResponse.json({ models, default: models[0] });
}
