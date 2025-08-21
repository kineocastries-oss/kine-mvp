// app/api/generatePdf/route.ts
import { NextRequest, NextResponse } from "next/server";
export const runtime = "nodejs";
export const maxDuration = 60;

import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

/* ---------- Helpers ENV ---------- */
function assertEnv() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const missing: string[] = [];
  if (!url) missing.push("NEXT_PUBLIC_SUPABASE_URL");
  if (!anon) missing.push("NEXT_PUBLIC_SUPABASE_ANON_KEY");
  if (!service) missing.push("SUPABASE_SERVICE_ROLE_KEY");
  if (missing.length) throw new Error(`Variables d'environnement manquantes: ${missing.join(", ")}.`);
  return { url, anon, service };
}

function getAdminClient(): SupabaseClient<any> {
  const { url, service } = assertEnv();
  return createClient<any>(url!, service!);
}

/** p peut être "audio/<id>/seg-X.webm" ou "<id>/seg-X.webm" */
async function downloadFromAudioBucket(supabase: SupabaseClient<any>, p: string) {
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

/* ---------- PDF via pdf-lib (aucune lecture de fichier) ---------- */
async function createSimplePdfWithPdfLib(title: string, body: string) {
  const pdfDoc = await PDFDocument.create();
  const page = pdfDoc.addPage([595.28, 841.89]); // A4 en points (72 dpi)
  const { width, height } = page.getSize();

  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  const margin = 40;
  let x = margin;
  let y = height - margin;

  // Title
  const titleSize = 18;
  page.drawText(title || "Bilan kinésithérapique", {
    x,
    y,
    size: titleSize,
    font: fontBold,
    color: rgb(0, 0, 0),
  });
  y -= titleSize + 16;

  // Body (très simple: une ligne = un paragraphe)
  const bodySize = 11;
  const maxWidth = width - margin * 2;
  const lines = (body || "(contenu vide)").split("\n");

  for (const line of lines) {
    // découpe naïve: si la ligne est trop longue, on la casse (approx)
    const words = line.split(" ");
    let current = "";
    const metrics = (s: string) => font.widthOfTextAtSize(s, bodySize);

    for (const w of words) {
      const test = current ? current + " " + w : w;
      if (metrics(test) > maxWidth) {
        page.drawText(current, { x, y, size: bodySize, font, color: rgb(0, 0, 0) });
        y -= bodySize + 4;
        current = w;
      } else {
        current = test;
      }
      if (y < margin + 40) {
        // nouvelle page si on atteint le bas
        const newPage = pdfDoc.addPage([595.28, 841.89]);
        page.drawText("", { x: 0, y: 0 }); // force usage de 'page' précédent
        page.setRotation(0 as any); // no-op
        // reset coords
        x = margin;
        y = 841.89 - margin;
      }
    }
    if (current) {
      page.drawText(current, { x, y, size: bodySize, font, color: rgb(0, 0, 0) });
      y -= bodySize + 8;
    } else {
      y -= bodySize + 8;
    }
  }

  // Footer
  const footer = "Consentement d’enregistrement recueilli. Audio supprimé après génération.";
  page.drawText(footer, {
    x: margin,
    y: margin,
    size: 8,
    font,
    color: rgb(0.2, 0.2, 0.2),
  });

  const bytes = await pdfDoc.save(); // Uint8Array
  return bytes;
}

// Stubs simples (remplace ensuite par Whisper/GPT)
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

    const { consultationId, patientName, emailKine, emailPatient, audioPaths } = await req.json();

    if (!consultationId) return NextResponse.json({ error: "consultationId manquant" }, { status: 400 });
    if (!emailKine) return NextResponse.json({ error: "emailKine manquant" }, { status: 400 });
    if (!Array.isArray(audioPaths) || audioPaths.length === 0) {
      return NextResponse.json({ error: "Aucun segment audio fourni" }, { status: 400 });
    }

    // 1) Download des segments
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

    // 2) Transcription
    const transcript = await transcribeAll(audioBuffers);

    // 3) Synthèse
    const reportText = await summarizeToReportText(transcript, patientName || "Patient");

    // 4) PDF (pdf-lib)
    const pdfBytes = await createSimplePdfWithPdfLib("Bilan kinésithérapique", reportText);

    // 5) Upload dans le bucket "pdf"
    const pdfPath = `pdf/${consultationId}.pdf`; // objet "pdf/..." dans le bucket "pdf"
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

    return NextResponse.json({ ok: true, pdfPath, url: signed?.signedUrl });
  } catch (e: any) {
    console.error(e);
    return NextResponse.json({ error: e.message ?? "Erreur serveur" }, { status: 500 });
  }
}
