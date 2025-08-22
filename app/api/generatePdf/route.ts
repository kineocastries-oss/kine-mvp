// app/api/generatePdf/route.ts
import { NextRequest, NextResponse } from "next/server";
export const runtime = "nodejs";
export const maxDuration = 300;

import { createClient, SupabaseClient } from "@supabase/supabase-js";
import OpenAI from "openai";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { writeFileSync, unlinkSync, existsSync, mkdirSync, createReadStream } from "fs";
import { join } from "path";

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
  if (missing.length) throw new Error(`Variables d'environnement manquantes: ${missing.join(", ")}`);
  return { url, service, openaiKey, resendKey, sender };
}

function adminSupabase(): SupabaseClient<any> {
  const { url, service } = assertEnv();
  return createClient<any>(url!, service!);
}

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY! });

/* ---------------------- Helpers Storage & logs ---------------------- */
const DEBUG = process.env.NODE_ENV !== "production" || process.env.DEBUG_LOGS === "1";
const log = (...a: any[]) => { if (DEBUG) console.log("[generatePdf]", ...a); };

const normalizeAudioPath = (p: string) => (p.startsWith("audio/") ? p.slice("audio/".length) : p);

async function downloadAudio(supabase: SupabaseClient<any>, path: string): Promise<Uint8Array> {
  const rel = normalizeAudioPath(path);
  const { data, error } = await supabase.storage.from("audio").download(rel);
  if (error) throw new Error(`Download fail "${rel}": ${error.message}`);
  const bytes = new Uint8Array(await data.arrayBuffer());
  return bytes;
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

/* ---------------------- Transcription (robuste via /tmp) ---------------------- */
function ensureTmpDir(): string {
  const dir = "/tmp/kine-audio";
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return dir;
}

async function transcribeSegments(buffers: Uint8Array[]) {
  const tmpDir = ensureTmpDir();
  const parts: string[] = [];

  for (let i = 0; i < buffers.length; i++) {
    const buf = buffers[i];
    log(`Seg ${i + 1} size(bytes)=`, buf.length);

    // écrit le segment en /tmp
    const filename = `seg-${Date.now()}-${i + 1}.webm`;
    const filePath = join(tmpDir, filename);
    writeFileSync(filePath, Buffer.from(buf));
    try {
      const tr = await openai.audio.transcriptions.create({
        file: createReadStream(filePath) as any, // ReadStream fiable en serverless
        model: "whisper-1",
        language: "fr",
      });
      const txt: string = (tr as any)?.text?.trim() || "";
      log(`Whisper seg ${i + 1} text(len)=`, txt.length, txt.slice(0, 120).replace(/\n/g, " "));
      if (txt) parts.push(txt);
    } catch (e: any) {
      log(`Whisper error on seg ${i + 1}:`, e?.message || e);
    } finally {
      try { unlinkSync(filePath); } catch {}
    }
  }

  return parts.join("\n\n---\n\n");
}

/* ---------------------- Synthèse GPT & PDF ---------------------- */
/** NOUVEAU PROMPT : texte final propre, sans Markdown, sans "NR", sections dynamiques et numérotées */
const SYSTEM_PROMPT = `Tu es un assistant pour kinésithérapeute.
Tu reçois une transcription brute d’un échange patient‑kiné.
Objectif : produire un TEXTE FINAL en français professionnel, prêt à être posé tel quel dans un PDF.

CONTRAINTES IMPÉRATIVES DE SORTIE :
- AUCUN Markdown (pas de #, ##, *, -, _).
- PAS de placeholders ("NR", "N/A", "non renseigné").
- N’AFFICHE QUE les lignes qui ont un contenu réel ; si une info manque, n’écris rien (supprime la ligne).
- Omettre totalement une section si toutes ses lignes sont absentes.
- Les sections présentes DOIVENT être numérotées 1., 2., 3., … de façon continue (pas de trous).
- Style clair, professionnel, phrases courtes, lisibles.

STRUCTURE CIBLE EXACTE (n’inclus une ligne que si elle a un contenu réel dans la transcription) :

Bilan kinésithérapique

1. Informations patient
Nom et prénom : {…}
Âge : {…}
Situation familiale : {…}
Activité professionnelle : {…}
Activités sociales et loisirs : {…}
Antécédents médicaux importants : {…}

2. Motif de consultation
Raison de la venue : {…}
Contexte d’apparition : {…}
Examens complémentaires : {…}
Parcours de soins déjà réalisé : {…}

3. Évaluation clinique
Douleur : {…}
Incapacités fonctionnelles : {…}
Observation clinique : {…}
Tests spécifiques : {…}
Facteurs aggravants ou de risque : {…}

4. Explications données au patient
Origine probable du trouble : {…}
Lien avec son mode de vie ou antécédents : {…}
Éléments de compréhension : {…}

5. Plan de traitement
Objectifs principaux : {…}
Techniques envisagées : {…}
Fréquence et durée : {…}

NOTES :
- Réécris/condense les informations de la transcription pour remplir ces rubriques.
- Si une section ne contient rien, supprime la section entière et renumérote les suivantes automatiquement.
- Ne pas ajouter de “Mentions” en fin de texte (le PDF a déjà un pied de page).`;

async function generateReportMarkdown(transcript: string, patientName: string) {
  const user = [
    `Patient: ${patientName || "Patient"}`,
    "",
    "Transcription (FR):",
    "```",
    transcript,
    "```",
    "",
    "Rédige le bilan FINAL au format demandé ci‑dessus.",
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
  log("GPT head:", md.slice(0, 200).replace(/\n/g, " "));
  return md;
}

/** Nettoyage minimal (au cas où le modèle glisse encore un peu de markdown) */
function stripMarkdown(md: string) {
  return md
    .replace(/^#{1,6}\s*/gm, "")      // titres markdown
    .replace(/\*\*(.*?)\*\*/g, "$1")  // gras
    .replace(/\*(.*?)\*/g, "$1")      // italique
    .replace(/`{1,3}([^`]+)`{1,3}/g, "$1") // code inline/blocs
    // ❌ ne convertit plus "- " en "• " pour éviter toute puce non voulue
    .replace(/\r/g, "")
    .trim();
}

/** Rendu PDF simple (pdf-lib) : imprime le texte tel quel, avec un pied de page standard */
async function renderPdf(title: string, body: string) {
  const pdfDoc = await PDFDocument.create();
  let page = pdfDoc.addPage([595.28, 841.89]); // A4
  const { width, height } = page.getSize();
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  const margin = 40;
  let y = height - margin;

  const drawLine = (text: string, size = 11, bold = false) => {
    const f = bold ? fontBold : font;
    page.drawText(text, { x: margin, y, size, font: f, color: rgb(0, 0, 0) });
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
  const words = (body || "").split(/\s+/);
  let current = "";
  for (const w of words) {
    const test = current ? current + " " + w : w;
    if (font.widthOfTextAtSize(test, size) > maxWidth) {
      if (current.trim()) drawLine(current, size, false);
      current = w;
    } else {
      current = test;
    }
  }
  if (current.trim()) drawLine(current, size, false);

  // Pied de page (unique)
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


