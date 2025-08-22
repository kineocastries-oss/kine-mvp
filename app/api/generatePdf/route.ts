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
      const tr = await (openai as any).audio.transcriptions.create({
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

/* ---------------------- Synthèse GPT & mise en page ---------------------- */
/** PROMPT : sortie ligne-par-ligne, aérée, sans Markdown/placeholder, sections dynamiques & numérotées */
const SYSTEM_PROMPT = `Tu es un assistant pour kinésithérapeute.
Tu reçois une transcription brute d’un échange patient-kiné.
But : produire un TEXTE FINAL en français professionnel, AÉRÉ et LISIBLE, prêt à être posé tel quel dans un PDF.

RÈGLES IMPÉRATIVES :
- AUCUN Markdown (pas de #, ##, *, -, _).
- PAS de placeholders ("NR", "N/A", "{...}", "[...]").
- CHAQUE information doit être sur UNE LIGNE distincte.
- Laisse UNE LIGNE VIDE entre chaque section.
- Si une information est inconnue, SUPPRIME toute la ligne correspondante.
- Si une section entière est vide, OMETS-LA complètement.
- Numérotation stricte des sections : 1., 2., 3., … (continue, sans trous).
- Style clair, phrases courtes, vocabulaire professionnel.

MISE EN PAGE EXACTE À PRODUIRE (n’écris une ligne que si elle a un contenu réel) :

Bilan kinésithérapique

1. Informations patient
Nom et prénom : …
Âge : …
Situation familiale : …
Activité professionnelle : …
Activités sociales et loisirs : …
Antécédents médicaux importants : …

2. Motif de consultation
Raison de la venue : …
Contexte d’apparition : …
Examens complémentaires : …
Parcours de soins déjà réalisé : …

3. Évaluation clinique
Douleur : …
Incapacités fonctionnelles : …
Observation clinique : …
Tests spécifiques : …
Facteurs aggravants ou de risque : …

4. Explications données au patient
Origine probable du trouble : …
Lien avec son mode de vie ou antécédents : …
Éléments de compréhension : …

5. Plan de traitement
Objectifs principaux : …
Techniques envisagées : …
Fréquence et durée : …

NOTES :
- Chaque rubrique commence par son titre de section sur UNE LIGNE DÉDIÉE.
- Les informations de la rubrique sont chacune sur LEUR PROPRE LIGNE.
- Une LIGNE VIDE sépare les sections.
- Ne pas ajouter de “Mentions” à la fin (le pied de page du PDF les gère).`;

async function generateReportText(transcript: string, patientName: string) {
  const user = [
    `Patient: ${patientName || "Patient"}`,
    "",
    "Transcription (FR) :",
    transcript,
    "",
    "Produis le texte final AU FORMAT IMPOSÉ ci-dessus."
  ].join("\n");

  const completion = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    temperature: 0.2,
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: user },
    ],
  });

  const txt = completion.choices[0]?.message?.content?.trim() || "";
  log("GPT head:", txt.slice(0, 200).replace(/\n/g, " "));
  return txt;
}

/** Nettoyage minimal (sécurité si un soupçon de markdown passe) */
function stripMarkdown(md: string) {
  return md
    .replace(/^#{1,6}\s*/gm, "")      // titres markdown
    .replace(/\*\*(.*?)\*\*/g, "$1")  // gras
    .replace(/\*(.*?)\*/g, "$1")      // italique
    .replace(/`{1,3}([^`]+)`{1,3}/g, "$1") // code inline/blocs
    .replace(/\r/g, "")
    .trim();
}

/* ---------------------- Rendu PDF lisible & aéré ---------------------- */
/**
 * Respecte les sauts de ligne du texte (une info par ligne, une ligne vide entre sections).
 * - Espacement vertical augmenté (taille + 10).
 * - Détection simple des titres de sections (ex: "1. Informations patient") pour gras léger.
 */
async function renderPdf(title: string, body: string) {
  const pdfDoc = await PDFDocument.create();
  let page = pdfDoc.addPage([595.28, 841.89]); // A4
  const { width, height } = page.getSize();
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  const margin = 40;
  const lineSpacing = 10; // plus d'air
  let y = height - margin;

  const maxWidth = width - margin * 2;

  const ensureSpace = (size = 11) => {
    if (y < margin + 50) {
      page = pdfDoc.addPage([595.28, 841.89]);
      y = height - margin;
    }
  };

  // Dessine une ligne (sans wrap)
  const drawLineRaw = (text: string, size = 11, bold = false) => {
    ensureSpace(size);
    const f = bold ? fontBold : font;
    page.drawText(text, { x: margin, y, size, font: f, color: rgb(0, 0, 0) });
    y -= size + lineSpacing;
  };

  // Wrap d'un paragraphe (en respectant les espaces)
  const drawWrappedLine = (text: string, size = 11, bold = false) => {
    const f = bold ? fontBold : font;
    let current = "";
    const words = text.split(/\s+/);
    for (const w of words) {
      const test = current ? current + " " + w : w;
      if (f.widthOfTextAtSize(test, size) > maxWidth) {
        if (current.trim()) drawLineRaw(current, size, bold);
        current = w;
      } else {
        current = test;
      }
    }
    if (current.trim()) drawLineRaw(current, size, bold);
  };

  // Titre principal
  drawWrappedLine(title || "Bilan kinésithérapique", 18, true);
  y -= 2;

  // On respecte les retours à la ligne du corps : une ligne du texte = un bloc à dessiner.
  const lines = (body || "").split("\n");

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i] ?? "";
    const line = raw.replace(/\s+$/g, ""); // trim right

    // Ligne vide => espace supplémentaire (séparation sections)
    if (!line.trim()) {
      y -= 4; // petit gap en plus pour l'aération
      continue;
    }

    // Détection simple d'un titre de section ("1. …", "2. …", etc.)
    const isSectionTitle = /^\d+\.\s/.test(line);

    // Taille un peu plus grande pour le 2. Motif..., 3. Évaluation..., etc. (optionnel)
    const size = isSectionTitle ? 13 : 11;

    drawWrappedLine(line, size, isSectionTitle);
  }

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
      try {
        const buf = await downloadAudio(supabase, p);
        audioBuffers.push(buf);
      } catch (e: any) {
        return NextResponse.json(
          { error: `Téléchargement audio impossible (${p}) : ${e.message}` }, { status: 400 }
        );
      }
    }

    // 2) Transcription (robuste)
    let transcript = await transcribeSegments(audioBuffers);
    log("Transcript head:", transcript.slice(0, 200).replace(/\n/g, " "));

    if (!transcript.trim()) {
      transcript = "(Transcription indisponible — audio reçu mais non reconnu par Whisper. Vérifier format/codec.)";
    }

    // 3) Synthèse (GPT) — texte final au format souhaité (sans markdown/placeholder, avec lignes et sauts)
    const textFinal = stripMarkdown(await generateReportText(transcript, patientName || "Patient"));

    // 4) PDF (aéré & lisible)
    const pdfBytes = await renderPdf(`Bilan kinésithérapique — ${patientName || "Patient"}`, textFinal);

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
            "<p>— GPT‑Kiné</p>"
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

    return NextResponse.json({ ok: true, url, pdfPath });
  } catch (e: any) {
    console.error(e);
    return NextResponse.json({ error: e.message || "Erreur serveur" }, { status: 500 });
  }
}


