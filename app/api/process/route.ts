// app/api/process/route.ts
import { NextRequest, NextResponse } from "next/server";
import OpenAI from "openai";
import { createClient } from "@supabase/supabase-js";
// @ts-ignore - pdfkit CJS
import PDFDocument from "pdfkit";
import { Resend } from "resend";
import { marked } from "marked";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// ===== Helpers ENV =====
function assertEnv() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const openaiKey = process.env.OPENAI_API_KEY;
  const resendKey = process.env.RESEND_API_KEY;
  const sender = process.env.SENDER_EMAIL;

  const missing: string[] = [];
  if (!url) missing.push("NEXT_PUBLIC_SUPABASE_URL");
  if (!anon) missing.push("NEXT_PUBLIC_SUPABASE_ANON_KEY");
  if (!service) missing.push("SUPABASE_SERVICE_ROLE_KEY");
  if (!openaiKey) missing.push("OPENAI_API_KEY");
  if (!resendKey) missing.push("RESEND_API_KEY"); // si l’envoi mail est optionnel, tu peux retirer ce check
  if (!sender) missing.push("SENDER_EMAIL");

  if (missing.length) {
    throw new Error(
      `Variables d'environnement manquantes: ${missing.join(
        ", "
      )}. Ajoute-les dans Vercel > Settings > Environment Variables.`
    );
  }

  return {
    url,
    anon,
    service,
    openaiKey,
    resendKey,
    sender,
  };
}

function getAdminClient() {
  const { url, service } = assertEnv();
  return createClient(url!, service!); // service role côté serveur UNIQUEMENT
}

// ===== Utils PDF =====
function pdfKitToBuffer(doc: any): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    doc.on("data", (c: Buffer) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
    doc.end();
  });
}

// ===== Handler =====
export async function POST(req: NextRequest) {
  try {
    const env = assertEnv();
    const supabase = getAdminClient();

    const openai = new OpenAI({ apiKey: env.openaiKey! });
    const resend = new Resend(env.resendKey!);

    const form = await req.formData();
    const patient = String(form.get("patient") || "Patient");
    const clinicianEmail = String(form.get("clinician_email") || "demo@demo");
    const sendTo = String(form.get("send_to") || "");

    // Fichiers audio (multi-part)
    const files = form.getAll("audios").filter((f) => f instanceof File) as File[];
    if (files.length === 0) {
      return NextResponse.json({ error: "Aucun fichier audio" }, { status: 400 });
    }

    const transcriptParts: string[] = [];

    for (const file of files) {
      const arrayBuf = await file.arrayBuffer();
      const buffer = Buffer.from(arrayBuf);

      // 1) Upload brut (optionnel si tu veux conserver une trace avant transcription)
      const audioPath = `raw/${crypto.randomUUID()}.webm`;
      const { error: upErr } = await supabase.storage.from("audio").upload(audioPath, buffer, {
        contentType: file.type || "audio/webm",
        upsert: false,
      });
      if (upErr) throw upErr;

      // 2) Transcription (Whisper)
      const tr = await openai.audio.transcriptions.create({
        file: new File([buffer], "audio.webm", { type: "audio/webm" }) as any,
        model: "whisper-1",
        language: "fr",
      });
      const text = (tr as any).text || "";
      if (text) transcriptParts.push(text);

      // 3) Purge du fichier audio après transcription (si voulu)
      await supabase.storage.from("audio").remove([audioPath]);
    }

    const transcriptText = transcriptParts.join("\n\n---\n\n");

    // ===== Synthèse globale =====
    // chemins relatifs supprimés : on n’utilise plus lib/prompt pour éviter l’import à build-time.
    // Remplace systemPrompt/userPrompt ci-dessous par ton contenu si tu veux garder tes prompts dédiés.
    const systemPrompt =
      "Tu es un assistant qui génère des bilans kinésithérapiques clairs et structurés à partir de transcriptions.";
    const userPrompt = (transcript: string, patientName: string) =>
      `Transcription (FR) pour le patient ${patientName}:\n\n${transcript}\n\nGénère un bilan synthétique + un schéma JSON minimal des infos clés (entre accolades), puis du markdown.`;

    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      temperature: 0.2,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt(transcriptText, patient) },
      ],
    });

    const full = completion.choices[0]?.message?.content || "";
    const jsonStart = full.indexOf("{");
    const jsonEnd = full.lastIndexOf("}");
    const jsonStr = jsonStart >= 0 ? full.slice(jsonStart, jsonEnd + 1) : "{}";
    let schemaJson: any = {};
    try {
      schemaJson = JSON.parse(jsonStr);
    } catch {
      // on continue si le JSON n'est pas parfaitement parseable
    }
    const markdown = full.slice(jsonEnd + 1).trim();

    // Markdown -> HTML -> Texte pour PDF
    const html = (marked.parse(markdown) as string) || "";
    const plainText = html
      .replace(/<[^>]+>/g, "")
      .replace(/&nbsp;/g, " ")
      .replace(/&amp;/g, "&");

    // ===== PDF (PDFKit) =====
    const pdfBuffer = await (async () => {
      const doc = new PDFDocument({ margin: 40 });
      doc.fontSize(16).text(`Bilan de kinésithérapie — ${patient}`, { align: "left" });
      doc.moveDown();
      doc.fontSize(11).text(plainText, { align: "left" });
      doc.moveDown();
      doc
        .fontSize(8)
        .text("Consentement d’enregistrement recueilli. Audio supprimé après génération.", {
          align: "left",
        });
      return await pdfKitToBuffer(doc);
    })();

    // ===== Upload PDF =====
    const pdfPath = `pdf/${crypto.randomUUID()}.pdf`; // objet "pdf/xxx.pdf" dans le bucket "pdf"
    const { error: pdfErr } = await supabase.storage.from("pdf").upload(pdfPath, pdfBuffer, {
      contentType: "application/pdf",
      upsert: false,
    });
    if (pdfErr) throw pdfErr;

    const { data: signed } = await supabase.storage.from("pdf").createSignedUrl(pdfPath, 60 * 60);

    // ===== Email (optionnel) =====
    if (sendTo) {
      const to = sendTo
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);

      try {
        await resend.emails.send({
          from: env.sender!,
          to,
          subject: `Bilan kinésithérapie – ${patient}`,
          html: `<p>Bonjour,</p><p>Voici le bilan (lien valable 1h) :</p><p><a href="${signed?.signedUrl}">Télécharger le PDF</a></p>`,
          attachments: [{ filename: `Bilan-${patient}.pdf`, content: pdfBuffer.toString("base64") }],
        });
      } catch {
        // on ne bloque pas le flux si l'email échoue
      }
    }

    return NextResponse.json({
      ok: true,
      pdfUrl: signed?.signedUrl,
      patient,
      json: schemaJson,
    });
  } catch (e: any) {
    console.error(e);
    return NextResponse.json({ error: e.message || "Erreur serveur" }, { status: 500 });
  }
}

