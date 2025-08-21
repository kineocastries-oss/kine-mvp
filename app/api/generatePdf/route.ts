// Applications/API/generatePdf/route.ts
import { NextRequest, NextResponse } from "next/server";
export const runtime = "nodejs"; // pas "edge"
export const maxDuration = 60;

import { createClient } from "@supabase/supabase-js";
import { PDFDocument, StandardFonts } from "pdf-lib";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY! // service role: serveur ONLY
);

async function downloadFileFromStorage(path: string) {
  const { data, error } = await supabase.storage.from("audio").download(path);
  if (error) throw error;
  return new Uint8Array(await data.arrayBuffer());
}

async function uploadPdfToStorage(path: string, bytes: Uint8Array) {
  const { error } = await supabase.storage.from("pdf").upload(path, bytes, {
    contentType: "application/pdf",
    upsert: true,
  });
  if (error) throw error;
}

async function createSimplePdf(title: string, body: string) {
  const pdfDoc = await PDFDocument.create();
  const page = pdfDoc.addPage([595, 842]); // A4
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  const margin = 40;
  const maxWidth = 595 - margin * 2;
  const fontSizeTitle = 18;
  const fontSizeBody = 11;

  // Title
  page.drawText(title, {
    x: margin,
    y: 842 - margin - fontSizeTitle,
    size: fontSizeTitle,
    font: fontBold,
  });

  // Very simple text wrapping
  const words = body.split(/\s+/);
  let y = 842 - margin - fontSizeTitle - 24;
  let line = "";
  for (const w of words) {
    const test = line ? line + " " + w : w;
    const width = font.widthOfTextAtSize(test, fontSizeBody);
    if (width > maxWidth) {
      page.drawText(line, { x: margin, y, size: fontSizeBody, font });
      y -= 16;
      line = w;
      if (y < margin) break;
    } else {
      line = test;
    }
  }
  if (line) page.drawText(line, { x: margin, y, size: fontSizeBody, font });

  const bytes = await pdfDoc.save();
  return new Uint8Array(bytes);
}

// Fake transcription (à remplacer plus tard par Whisper/OpenAI)
async function transcribeAll(audioBuffers: Uint8Array[]) {
  return audioBuffers
    .map((_, i) => `Transcription du segment ${i + 1}`)
    .join("\n");
}

async function summarizeToReportText(
  transcript: string,
  patientName: string
) {
  return [
    `Bilan kinésithérapique – ${patientName}`,
    "",
    "Résumé de l’entretien :",
    transcript,
    "",
    "Conclusion & Plan :",
    "- Objectifs fonctionnels",
    "- Mobilisations / Renforcement",
    "- Fréquence des séances",
  ].join("\n");
}

export async function POST(req: NextRequest) {
  try {
    const { consultationId, patientName, emailKine, emailPatient, audioPaths } =
      await req.json();

    if (
      !consultationId ||
      !emailKine ||
      !Array.isArray(audioPaths) ||
      audioPaths.length === 0
    ) {
      return NextResponse.json(
        { error: "Paramètres invalides" },
        { status: 400 }
      );
    }

    // 1) Télécharge les segments audio
    const audioBuffers = await Promise.all(
      audioPaths.map(downloadFileFromStorage)
    );

    // 2) Transcrit
    const transcript = await transcribeAll(audioBuffers);

    // 3) Synthèse
    const reportText = await summarizeToReportText(
      transcript,
      patientName || "Patient"
    );

    // 4) PDF
    const pdfBytes = await createSimplePdf(
      "Bilan kinésithérapique",
      reportText
    );

    // 5) Upload dans bucket "pdf"
    const pdfPath = `pdf/${consultationId}.pdf`;
    await uploadPdfToStorage(pdfPath, pdfBytes);

    // 6) URL signée (valable 1h)
    const { data: signed, error: signErr } = await supabase.storage
      .from("pdf")
      .createSignedUrl(pdfPath, 60 * 60);
    if (signErr) throw signErr;
    const url = signed?.signedUrl;

    // 7) (Optionnel) mise à jour de ta table "consultations"
    await supabase
      .from("consultations")
      .update({
        pdf_path: pdfPath,
        status: "ready",
        email_kine: emailKine,
        email_patient: emailPatient ?? null,
      })
      .eq("id", consultationId);

    return NextResponse.json({
      ok: true,
      pdfPath,
      url,
      sentTo: [emailKine, ...(emailPatient ? [emailPatient] : [])],
    });
  } catch (e: any) {
    console.error(e);
    return NextResponse.json(
      { error: e.message ?? "Erreur serveur" },
      { status: 500 }
    );
  }
}

