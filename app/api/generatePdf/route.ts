// app/api/generatePdf/route.ts
import { NextRequest, NextResponse } from "next/server";
export const runtime = "nodejs";
export const maxDuration = 300;

import { createClient, SupabaseClient } from "@supabase/supabase-js";
import OpenAI from "openai";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

/* ---------------------- ENV & clients ---------------------- */
function assertEnv() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const openaiKey = process.env.OPENAI_API_KEY;
  const resendKey = process.env.RESEND_API_KEY;
  const sender = process.env.SENDER_EMAIL;

  const missing: string[] = [];
  if (!url) missing.push("NEXT_PUBLIC_SUPABASE_URL");
  if (!service) missing.push("SUPABASE_SERVICE_ROLE_KEY");
  if (!openaiKey) missing.push("OPENAI_API_KEY");
  if (!resendKey) missing.push("RESEND_API_KEY");
  if (!sender) missing.push("SENDER_EMAIL");
  if (missing.length) {
    throw new Error(`Variables d'environnement manquantes: ${missing.join(", ")}`);
  }
  return { url, service, openaiKey, resendKey, sender };
}

function adminSupabase(): SupabaseClient<any> {
  const { url, service } = assertEnv();
  return createClient<any>(url!, service!);
}

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY! });

/* ---------------------- Helpers Storage ---------------------- */
const DEBUG = process.env.NODE_ENV !== "production" || process.env.DEBUG_LOGS === "1";
const log = (...a: any[]) => { if (DEBUG) console.log("[generatePdf]", ...a); };

const normalizeAudioPath = (p: string) => (p.startsWith("audio/") ? p.slice("audio/".length) : p);

async function downloadAudio(supabase: SupabaseClient<any>, path: string): Promise<Uint8Array> {
  const rel = normalizeAudioPath(path);
  const { data, error } = await supabase.storage.from("audio").download(rel);
  if (error) throw new Error(`Download fail "${rel}": ${error.message}`);
  return new Uint8Array(await data.arrayBuffer());
}

async function uploadPdf(supabase: SupabaseClient<any>, path: string, bytes: Uint8Array) {
  const { error } = await supabase.storage.from("pdf").upload(path, bytes, {
    contentType: "application/pdf",
    upsert: true,
  });
  if (error) throw new Error(`Upload PDF fail "${path}": ${error.message}`);
}

async function signedPdfUrl(supabase: SupabaseClient<any>, path: string, ttlSeconds = 3600) {
  const { data, error } = await supabase.storage.from("pdf").createSignedUrl(path, ttlSeconds);
  if (error) throw new Error(`Signed URL fail: ${error.message}`);
  return data!.signedUrl;
}

/* ---------------------- Transcription & Rendu ---------------------- */
async function transcribeSegments(buffers: Uint8Array[]) {
  const parts: string[] = [];
  for (let i = 0; i < buffers.length; i++) {
    try {
      const f = new File([buffers[i]], `seg-${i + 1}.webm`, { type: "audio/webm" });
      const tr = await openai.audio.transcriptions.create({
        file: f as any,
        model: "whisper-1",
        language: "fr",
      });
      const txt = (tr as any)?.text?.trim() || "";
      log(`Whisper seg ${i + 1} len=`, txt.length);
      if (txt) parts.push(txt);
    } catch (e: any) {
      log(`Whisper error on seg ${i + 1}:`, e?.message || e);
    }
  }
  return parts.join("\n\n---\n\n");
}

const SYSTEM_PROMPT = `Tu es un assistant clinique pour kinésithérapeute.
Tu reçois une transcription brute d’un échange patient‑kiné.
Produis un bilan clair et exploitable, en français professionnel, concis, sans diagnostic médical.
Structure OBLIGATOIRE :
# Anamnèse
# Examen clinique
# Diagnostic kiné (hypothèses argumentées)
# Objectifs (court / moyen / long terme)
# Plan de soins (techniques, fréquence, exercices à domicile)
# Éducation thérapeutique (messages clés)
# Suivi (critères, prochain RDV)
À la fin, ajoute "Mentions : Consentement d’enregistrement recueilli."`;

async function generateReportMarkdown(transcript: string, patientName: string) {
  const user = [
    `Patient: ${patientName || "Patient"}`,
    "",
    "Transcription (FR):",
    "```",
    transcript,
    "```",
    "",
    "Rédige le bilan complet (sections obligatoires, listes à puces où utile).",
  ].join("\n");

  const completion = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    temperature: 0.2,
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: user },
    ],
  });

  const md = completion.choices[0]?.message?.content?.trim() || "";
  log("GPT md head:", md.slice(0, 200).replace(/\n/g, " "));
  return md;
}

function stripMarkdown(md: string) {
  return md
    .replace(/^#{1,6}\s*/gm, "")      // titres
    .replace(/\*\*(.*?)\*\*/g, "$1")  // bold
    .replace(/\*(.*?)\*/g, "$1")      // italic
    .replace(/`{1,3}([^`]+)`{1,3}/g, "$1")
    .replace(/^- /gm, "• ")
    .replace(/\r/g, "")
    .trim();
}

async function renderPdf(title: string, body: string) {
  const pdfDoc = await PDFDocument.create();
  let page = pdfDoc.addPage([595.28, 841.89]); // A4
  const { width, height } = page.getSize();
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  const margin = 40;
  let x = margin;
  let y = height - margin;
  const drawLine = (text: string, size = 11, bold = false) => {
    const f = bold ? fontBold : font;
    page.drawText(text, { x, y, size, font: f, color: rgb(0, 0, 0) });
    y -= size + 6;
    if (y < margin + 50) {
      page = pdfDoc.addPage([595.28, 841.89]);
      y = height - margin;
    }
  };

  // Titre
  drawLine(title || "Bilan kinésithérapique", 18, true);
  y -= 6;

  // Wrap simple
  const size = 11;
  const maxWidth = width - margin * 2;
  const words = body.split(/\s+/);
  let current = "";
  for (const w of words) {
    const test = current ? current + " " + w : w;
    if (font.widthOfTextAtSize(test, size) > maxWidth) {
      drawLine(current, size, false);
      current = w;
    } else {
      current = test;
    }
  }
  if (current) drawLine(current, size, false);

  // Pied de page
  page.drawText(
    "Généré automatiquement. Mentions : Consentement d’enregistrement recueilli.",
    { x: margin, y: margin, size: 8, font, color: rgb(0.25, 0.25, 0.25) }
  );

  return new Uint8Array(await pdfDoc.save());
}

/* ---------------------- Email (Resend) ---------------------- */
async function sendEmail({
  to, subject, html, pdfBytes, filename,
}: {
  to: string[]; subject: string; html: string; pdfBytes: Uint8Array; filename: string;
}) {
  const { Resend } = await import("resend");
  const { sender } = assertEnv();
  const resend = new Resend(process.env.RESEND_API_KEY!);

  await resend.emails.send({
    from: sender!,
    to,
    subject,
    html,
    attachments: [
      {
        filename,
        content: Buffer.from(pdfBytes).toString("base64"),
        content_type: "application/pdf",
      },
    ],
  });
}

/* ---------------------- Handler ---------------------- */
export async function POST(req: NextRequest) {
  try {
    const supabase = adminSupabase();
    const {
      consultationId,
      patientName,
      emailKine,
      emailPatient,
      audioPaths,
      sendEmailToKine = true,
    } = await req.json();

    if (!consultationId) return NextResponse.json({ error: "consultationId manquant" }, { status: 400 });
    if (!emailKine)     return NextResponse.json({ error: "emailKine manquant" }, { status: 400 });
    if (!Array.isArray(audioPaths) || audioPaths.length === 0)
      return NextResponse.json({ error: "Aucun segment audio fourni" }, { status: 400 });

    // 1) Télécharger l'audio
    const audioBuffers: Uint8Array[] = [];
    for (const p of audioPaths) {
      try { audioBuffers.push(await downloadAudio(supabase, p)); }
      catch (e: any) {
        return NextResponse.json(
          { error: `Téléchargement audio impossible (${p}) : ${e.message}` }, { status: 400 }
        );
      }
    }

    // 2) Transcription
    const transcript = await transcribeSegments(audioBuffers);
    log("Transcript head:", transcript.slice(0, 200).replace(/\n/g, " "));
    if (!transcript.trim())
      return NextResponse.json({ error: "Transcription vide. Vérifie l'audio / Whisper." }, { status: 400 });

    // 3) Synthèse (GPT)
    const md = await generateReportMarkdown(transcript, patientName || "Patient");
    const plain = stripMarkdown(md);

    // 4) PDF
    const pdfBytes = await renderPdf(`Bilan kinésithérapique — ${patientName || "Patient"}`, plain);

    // 5) Upload
    const pdfPath = `pdf/${consultationId}.pdf`;
    await uploadPdf(supabase, pdfPath, pdfBytes);

    // 6) URL signée
    const url = await signedPdfUrl(supabase, pdfPath, 3600);

    // 7) Email
    const recipients: string[] = [];
    if (sendEmailToKine && emailKine) recipients.push(emailKine);
    if (emailPatient) recipients.push(emailPatient);
    if (recipients.length > 0) {
      try {
        await sendEmail({
          to: recipients,
          subject: `Bilan kinésithérapique — ${patientName || "Patient"}`,
          html: [
            "<p>Bonjour,</p>",
            "<p>Veuillez trouver le bilan en pièce jointe.</p>",
            `<p>Lien (valide 1h) : <a href="${url}">Télécharger le PDF</a></p>`,
            "<p>— GPT‑Kiné</p>",
          ].join(""),
          pdfBytes,
          filename: `Bilan-${(patientName || "Patient").replace(/\s+/g, "_")}.pdf`,
        });
      } catch (e: any) {
        console.error("Resend email error:", e?.message || e);
        // on ne bloque pas la réponse si l'email échoue
      }
    }

    // 8) (Optionnel) update DB
    await supabase
      .from("consultations")
      .update({
        pdf_path: pdfPath,
        status: "ready",
        email_kine: emailKine,
        email_patient: emailPatient ?? null,
      })
      .eq("id", consultationId);

    return NextResponse.json({ ok: true, url, pdfPath, markdown: md });
  } catch (e: any) {
    console.error(e);
    return NextResponse.json({ error: e.message || "Erreur serveur" }, { status: 500 });
  }
}

