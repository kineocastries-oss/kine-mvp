import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST() {
  return NextResponse.json(
    { error: "Endpoint obsolète. Utilise /api/generatePdf (POST) pour générer le PDF et envoyer l’e-mail." },
    { status: 410 }
  );
}
