// app/api/process/route.ts
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Ancien endpoint remplacé par /api/generatePdf
export async function POST() {
  return NextResponse.json(
    {
      error:
        "Cet endpoint est obsolète. Utilisez /api/generatePdf avec { consultationId, patientName, emailKine, emailPatient?, audioPaths[] }.",
    },
    { status: 410 } // Gone
  );
}

// (optionnel) On bloque aussi GET proprement
export async function GET() {
  return NextResponse.json(
    { error: "Utilisez /api/generatePdf (POST) à la place." },
    { status: 404 }
  );
}

