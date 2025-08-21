// app/api/generatePdf/route.ts
import { NextRequest, NextResponse } from "next/server";
export const runtime = "nodejs";
export const maxDuration = 60;

import { createClient, SupabaseClient } from "@supabase/supabase-js";
// @ts-ignore (pdfkit est en CJS)
import PDFDocument from "pdfkit";

/* ---------- Helpers ENV ---------- */
function assertEnv() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const missing: string[] = [];
  if (!url) missing.push("NEXT_PUBLIC_SUPABASE_URL");
  if (!anon) missing.push("NEXT_PUBLIC_SUPABASE_ANON_KEY");
  if (!service) missing.push("SUPABASE_SERVICE_ROLE_KEY");
  if (missing.length) {
    throw new Error(
      `Variables d'environnement manquantes: ${missing.join(", ")}.`
    );
  }
  return { url, anon, service };
}

function getAdminClient(): SupabaseClient<any> {
  const { url, service } = assertEnv();
  // On ne précise pas de schéma générique pour éviter les conflits de types
  return createClient<any>(url!, service!);
}

/** Accepte n'importe quel SupabaseClient pour éviter les conflits de types */
async function downloadFromAudioBucket(
  supabase: SupabaseClient<any>,
  // p peut arriver sous forme "audio/<id>/seg-X.webm" OU "<id>/seg-X.webm"
  p: string
) {
  const relative = p.startsWith("audio/") ? p.slice("audio/".length) : p;
  const { data, error } = await supabase.storage.from("audio").download(relative);
  if (error) throw new Error(`Échec download "${relative}": ${error.message}`);
  return new Uint8Array(await data.arrayBuffer());
}

async function uploadPdfToPdfBucket(
  supabase: SupabaseClient<any>,
  path: string,
  bytes: Uint8Array
) {
  const { error } = await supabase.storage.from("pdf").upload(path, bytes, {
    contentType: "application/pdf",
    upsert: true,
  });
  if (error) throw new Error(`Échec upload PDF "${path}": ${error.message}`);
}

function pdfKitToBuffer(doc: any): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    doc.on("data", (c: Buffer) => chunks.push(c));
    doc.on("end", () => resolve(new Uint8Array(Buffer.concat(chunks))));
    doc.on("error", reject);
    doc.end();
  });
}

async function createSimplePdfWithPdfKit(title: string, body: string) {
  const doc = new PDFDocument({
    size: "A4",
    margins: { top: 40, bottom: 40, left: 40, right: 40 },
  });
  doc.font("Helvetica-Bold").fontSize(18).text(title, { align: "left" });
  doc.moveDown(1);
  doc.font("Helvetica").fontSize(11).text(body || "(contenu vide)", {
    align: "left",
  });
  return await pdfKitToBuffer(doc);
}

// Stubs simples (à remplacer par Whisper/GPT ensuite)
async function transcribeAll(_audioBuffers: Uint8Array[]) {
  return _audioBuffers.map((_, i) => `Transcription du segment ${i + 1}`).join("\n");
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

/* ---------- Handler ---------- */
export async function POST(req: NextRequest) {
  try {
    const supabase = getAdminClient();

    const { consultationId, patientName, emailKine, emailPatient, audioPaths } =
      await req.json();

    if (!consultationId) {
      return NextResponse.json({ error: "consultationId manquant" }, { status: 400 });
    }
    if (!emailKine) {
      return NextResponse.json({ error: "emailKine manquant" }, { status: 400 });
    }
    if (!Array.isArray(audioPaths) || audioPaths.length === 0) {
      return NextResponse.json({ error: "Aucun segment audio fourni" }, { status: 400 });
    }

    // 1) Download des segments (normalise les chemins)
    const audioBuffers: Uint8Array[] = [];
    for (const p of audioPaths) {
      try {
        const buf = await downloadFromAudioBucket(supabase, p);
        audioBuffers.push(buf);
      } catch (e: any) {
        return NextResponse.json(
          { error: `Impossible de télécharger ${p}: ${e.message || e}` },
          { status: 400 }
        );
      }
    }

    // 2) Transcription (stub)
    const transcript = await transcribeAll(audioBuffers);

    // 3) Synthèse (stub)
    const reportText = await summarizeToReportText(
      transcript,
      patientName || "Patient"
    );

    // 4) PDF
    const pdfBytes = await createSimplePdfWithPdfKit(
      "Bilan kinésithérapique",
      reportText
    );

    // 5) Upload PDF
    const pdfPath = `pdf/${consultationId}.pdf`; // objet "pdf/..." dans bucket "pdf"
    await uploadPdfToPdfBucket(supabase, pdfPath, pdfBytes);

    // 6) URL signée
    const { data: signed, error: signErr } = await supabase.storage
      .from("pdf")
      .createSignedUrl(pdfPath, 60 * 60);
    if (signErr) throw new Error(`Échec URL signée: ${signErr.message}`);

    // (optionnel) 7) update DB
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
      url: signed?.signedUrl,
    });
  } catch (e: any) {
    console.error(e);
    return NextResponse.json(
      { error: e.message ?? "Erreur serveur" },
      { status: 500 }
    );
  }
}
