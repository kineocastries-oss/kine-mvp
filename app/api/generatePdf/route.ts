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

async function signedPdfUrl(sabase: SupabaseClient<any>, path: string, ttlSeconds = 3600) {
  const { data, error } = await sabase.storage.from("pdf").createSignedUrl(path, ttlSeconds);
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
        file: createReadStream(filePath) as any,
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
const SYSTEM_PROMPT = `Tu es un assistant pour kinésithérapeute.
Tu reçois une transcription brute d’un échange patient-kiné.
But : produire un TEXTE FINAL en français professionnel, AÉRÉ et LISIBLE, prêt à être posé tel quel dans un PDF.

RÈGLES IMPÉRATIVES :
- AUCUN Markdown (pas de #, ##, *, -, _).
- PAS de placeholders ni points de suspension ("NR", "N/A", "{...}", "[...]", "…", "...").
- CHAQUE information doit être sur UNE LIGNE distincte.
- Laisse UNE LIGNE VIDE entre chaque section.
- Si une information est inconnue, SUPPRIME la ligne entière (n’écris rien à sa place).
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
- N’ajoute aucune mention finale (le pied de page du PDF les gère).`;

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

function stripMarkdown(md: string) {
  return md
    .replace(/^#{1,6}\s*/gm, "")
    .replace(/\*\*(.*?)\*\*/g, "$1")
    .replace(/\*(.*?)\*/g, "$1")
    .replace(/`{1,3}([^`]+)`{1,3}/g, "$1")
    .replace(/\r/g, "")
    .trim();
}

/** Supprime lignes incomplètes, sections vides, et renumérote 1., 2., 3., … */
function cleanAndRenumberBilan(raw: string): string {
  const lines = (raw || "").split("\n");

  // Garde l'en‑tête si présent
  let header = "";
  if (lines.length && lines[0].trim().toLowerCase().startsWith("bilan kinésithérapique")) {
    header = "Bilan kinésithérapique";
    lines.shift();
  }

  const sections: { title: string; items: string[] }[] = [];
  let current: { title: string; items: string[] } | null = null;

  const isSectionTitle = (s: string) => /^\d+\.\s/.test(s.trim());
  const isEmptyItem = (s: string) => {
    const t = s.trim();
    if (!t) return true;
    const m = t.match(/^([^:]+):\s*(.*)$/);
    if (!m) return false;
    const val = m[2].trim();
    if (!val) return true;
    if (val === "…" || val === "...") return true;
    if (/^\.{2,}$/.test(val)) return true;
    return false;
  };

  for (const rawLine of lines) {
    const line = rawLine.replace(/\s+$/g, "");
    if (!line.trim()) continue;
    if (isSectionTitle(line)) {
      if (current) sections.push(current);
      current = { title: line.trim(), items: [] };
    } else {
      if (!current) continue;
      if (!isEmptyItem(line)) current.items.push(line.trim());
    }
  }
  if (current) sections.push(current);

  const kept = sections.filter(s => s.items.length > 0);
  kept.forEach((s, idx) => {
    const titleNoNum = s.title.replace(/^\d+\.\s*/, "");
    s.title = `${idx + 1}. ${titleNoNum}`;
  });

  const out: string[] = [];
  if (header) out.push(header, "");
  kept.forEach((s, i) => {
    out.push(s.title);
    s.items.forEach(it => out.push(it));
    if (i < kept.length - 1) out.push("");
  });

  return out.join("\n");
}

/* ---------------------- DATE utilitaires ---------------------- */
function formatTodayFR(options?: Intl.DateTimeFormatOptions) {
  const fmt = new Intl.DateTimeFormat("fr-FR", {
    timeZone: "Europe/Paris",
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
    ...options,
  });
  return fmt.format(new Date());
}

function formatTodayShort() {
  const d = new Date();
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const yyyy = d.getFullYear();
  return `${dd}-${mm}-${yyyy}`; // ex: 23-08-2025
}

/* ---------------------- Rendu PDF lisible & aéré ---------------------- */
async function renderPdf(title: string, body: string) {
  const pdfDoc = await PDFDocument.create();
  let page = pdfDoc.addPage([595.28, 841.89]); // A4
  const { width, height } = page.getSize();
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  const margin = 40;
  const lineSpacing = 10;
  let y = height - margin;
  const maxWidth = width - margin * 2;

  const ensureSpace = (size = 11) => {
    if (y < margin + 50) {
      page = pdfDoc.addPage([595.28, 841.89]);
      y = height - margin;
    }
  };

  const drawLineRaw = (text: string, size = 11, bold = false) => {
    ensureSpace(size);
    const f = bold ? fontBold : font;
    page.drawText(text, { x: margin, y, size, font: f, color: rgb(0, 0, 0) });
    y -= size + lineSpacing;
  };

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

  // ---- Titre principal
  const mainTitle = title || "Bilan kinésithérapique";
  drawWrappedLine(mainTitle, 18, true);

  // ---- Date du jour (Europe/Paris) sous le titre
  const dateStr = formatTodayFR();
  drawWrappedLine(`Date : ${dateStr}`, 11, false);

  y -= 4; // petit espace

  // ---- Corps (ligne par ligne)
  const lines = (body || "").split("\n");
  for (const raw of lines) {
    const line = raw.replace(/\s+$/g, "");
    if (!line.trim()) { y -= 4; continue; }
    const isSectionTitle = /^\d+\.\s/.test(line);
    const size = isSectionTitle ? 13 : 11;
    drawWrappedLine(line, size, isSectionTitle);
  }

  // ---- Pied de page (note sur la dernière page courante)
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
    contentType: "application/pdf", // ✅ camelCase
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

    // ➜ Tri par seg-(n).webm + dédoublonnage
    const orderedPaths = [...new Set<string>(audioPaths)].sort((a, b) => {
      const na = Number(a.match(/seg-(\d+)\.webm/)?.[1] || 0);
      const nb = Number(b.match(/seg-(\d+)\.webm/)?.[1] || 0);
      return na - nb;
    });

    // 1) Télécharger l'audio (dans l'ordre)
    const audioBuffers: Uint8Array[] = [];
    for (const p of orderedPaths) {
      try {
        const buf = await downloadAudio(supabase, p);
        audioBuffers.push(buf);
      } catch (e: any) {
        return NextResponse.json(
          { error: `Téléchargement audio impossible (${p}) : ${e.message}` }, { status: 400 }
        );
      }
    }

    // 2) Transcription
    let transcript = await transcribeSegments(audioBuffers);
    log("Transcript head:", transcript.slice(0, 200).replace(/\n/g, " "));
    if (!transcript.trim()) {
      transcript = "(Transcription indisponible — audio reçu mais non reconnu par Whisper. Vérifier format/codec.)";
    }

    // 3) Synthèse (GPT) → texte formaté
    const fromGpt = await generateReportText(transcript, patientName || "Patient");
    const cleaned = cleanAndRenumberBilan(stripMarkdown(fromGpt));

    // 4) PDF (titre sans date, date ajoutée juste dessous par renderPdf)
    const pdfBytes = await renderPdf(`Bilan kinésithérapique — ${patientName || "Patient"}`, cleaned);

    // 5) Upload
    const pdfPath = `pdf/${consultationId}.pdf`;
    await uploadPdf(supabase, pdfPath, pdfBytes);

    // 6) URL signée
    const url = await signedPdfUrl(supabase, pdfPath, 3600);

    // 7) Email — nom de fichier avec date courte
    const dateShort = formatTodayShort();
    const pdfFilename = `Bilan-${(patientName || "Patient").replace(/\s+/g, "_")}-${dateShort}.pdf`;

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
          filename: pdfFilename,
        });
      } catch (e: any) {
        console.error("Resend email error:", e?.message || e);
      }
    }

    // 8) Update DB
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

