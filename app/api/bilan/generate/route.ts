import { NextRequest, NextResponse } from "next/server";
import { buildSections } from "@/lib/bilan/normalize";
import type { BilanInput } from "@/lib/bilan/schema";
import { renderBilanPdf } from "@/lib/pdf/render";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const { input }: { input: BilanInput } = await req.json();

    const sections = buildSections(input);
    const pdf = await renderBilanPdf(sections);

    return new NextResponse(pdf, {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="bilan.pdf"`,
      },
    });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "Erreur inconnue" }, { status: 500 });
  }
}
