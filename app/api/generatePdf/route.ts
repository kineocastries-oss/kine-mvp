// app/api/generatePdf/route.ts
import { NextRequest, NextResponse } from "next/server";
export const runtime = "nodejs"; // surtout pas "edge"
export const maxDuration = 60;

import { createClient } from "@supabase/supabase-js";
// @ts-ignore - pdfkit a un export par défaut CommonJS
import PDFDocument from "pdfkit";

/** ---------- Supabase client (service role côté serveur) ---------- */
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY! // NE PAS exposer côté client
);

/** ---------- Utils Storage ---------- */
async function downloadFromAudioBucket(path: string) {
  const { data, error } = await supabase.storage.from("audio").download(path);
  if (error) throw error;
  return new Uint8Array(await data.arrayBuffer());
}

async function uploadPdfToPdfBucket(path: string, bytes: Uint8Array) {
  const { error } = await supabase.storage.from("pdf").upload(path, bytes, {
    contentType: "application/pdf",
    upsert: true,
  });
  if (error) throw error;
}

/** Convertit un PDFKit doc en Buffer/Uint8Array */
function pdfKitToBuffer(doc: any): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    doc.on("data", (chunk: Buffer) => chunks.push(chunk));
    doc.on("end", () => resolve(new Uint8Array(Buffer.concat(chunks))));
    doc.on("error", reject);
    doc.end();
  });
}

/** ---------- PDF (PDFKit) ---------- */
async function createSimplePdfWithPdfKit(title: string, body: string) {
  const doc = new PDFDocument({ size: "A4", margins: { top: 40, bottom: 40, left: 40, right: 40 } });

  // Titre
  doc.font("Helvetica-Bold").fontSize(18).text(title, { align: "left" });
  doc.moveDown(1);

  // Corps
  doc.font("Helvetica").fontSize(11).text(body, {
    width: 595 - 40 * 2, // largeur A4 - marges
    align: "left",
  });

  return await pdfKitToBuffer(doc);
}

/** ---------- Stubs transcription/synthèse (à brancher plus tard) ---------- */
async function transcribeAll(audioBuffers: Uint8Array[]) {
  // Remplace par Whisper/OpenAI quand tu veux (ici on “simule”)
  return audioBuffers.map((_, i) => `Transcription du segment ${i + 1}`).join("\n");
}

async function summarizeToReportText(transcript: string, patientName: string) {
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

/** ---------- Handler ---------- */
export async function POST(req: NextRequest) {
  try {
    const { consultationId, patientName, emailKine, emailPatient, audioPaths } = await req.json();

    if (!consultationId || !emailKine || !Array.isArray(audioPaths) || audioPaths.length === 0) {
      return NextResponse.json({ error: "Paramètres invalides" }, { status: 400 });
    }

    // 1) Récupère les segments audio depuis le bucket "audio"
    const audioBuffers = await Promise.all(audioPaths.map(downloadFromAudioBucket));

    // 2) Transcription
    const transcript = await transcribeAll(audioBuffers);

    // 3) Synthèse textuelle du bilan
    const reportText = await summarizeToReportText(transcript, patientName || "Patient");

    // 4) Génération PDF (PDFKit)
    const pdfBytes = await createSimplePdfWithPdfKit("Bilan kinésithérapique", reportText);

    // 5) Upload dans bucket "pdf"
    const pdfPath = `pdf/${consultationId}.pdf`; // chemin dans le bucket "pdf"
    await uploadPdfToPdfBucket(pdfPath, pdfBytes);

    // 6) URL signée (1h)
    const { data: signed, error: signErr } = await supabase.storage
      .from("pdf")
      .createSignedUrl(pdfPath, 60 * 60);
    if (signErr) throw signErr;
    const url = signed?.signedUrl;

    // 7) (Optionnel) Mise à jour table "consultations"
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
    return NextResponse.json({ error: e.message ?? "Erreur serveur" }, { status: 500 });
  }
}


