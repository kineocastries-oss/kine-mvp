import { NextRequest, NextResponse } from "next/server";
import OpenAI from "openai";
import { supabaseServer } from "../../../lib/supabase";
import { systemPrompt, userPrompt } from "../../../lib/prompt";
import { Resend } from "resend";
import { marked } from "marked";
import PDFDocument from "pdfkit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const resend = new Resend(process.env.RESEND_API_KEY);

/* ---------------------- Email helper ---------------------- */
async function sendEmail(to: string[], patient: string, pdfBytes: Buffer) {
  const sender = process.env.SENDER_EMAIL;
  if (!sender) throw new Error("SENDER_EMAIL non défini");

  const filename = `Bilan-${patient}.pdf`;
  const subject = `Bilan kinésithérapie – ${patient}`;
  const html = `<p>Bonjour,</p>
    <p>Voici le bilan kinésithérapie en PDF :</p>
    <p><strong>${patient}</strong></p>`;

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
} // ✅ ICI : fermeture de la fonction sendEmail

/* ---------------------- Handler ---------------------- */
export async function POST(req: NextRequest) {
  try {
    const form = await req.formData();
    const patient = String(form.get("patient") || "Patient");
    const clinicianEmail = String(form.get("clinician_email") || "");
    const sendTo = String(form.get("send_to") || "");

    const files = form.getAll("audios").filter(f => f instanceof File) as File[];
    if (files.length === 0) {
      return NextResponse.json({ error: "Aucun fichier audio" }, { status: 400 });
    }

    const transcriptParts: string[] = [];

    for (const file of files) {
      const arrayBuf = await file.arrayBuffer();
      const buffer = Buffer.from(arrayBuf);

      const tr = await openai.audio.transcriptions.create({
        file: new File([buffer], "audio.webm", { type: "audio/webm" }) as any,
        model: "whisper-1",
        language: "fr",
      });
      const text = (tr as any).text || "";
      if (text) transcriptParts.push(text);
    }

    const transcriptText = transcriptParts.join("\n\n---\n\n");

    // Synthèse via GPT
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
      // ignore JSON parse error
    }
    const markdown = full.slice(jsonEnd + 1).trim();

    // Convertir Markdown → texte brut
    const html = marked.parse(markdown) as string;
    const plainText = html
      .replace(/<[^>]+>/g, "")
      .replace(/&nbsp;/g, " ")
      .replace(/&amp;/g, "&");

    // Génération du PDF
    const pdfBuffer = await new Promise<Buffer>((resolve) => {
      const doc = new PDFDocument({ margin: 40 });
      const chunks: Buffer[] = [];
      doc.on("data", (c) => chunks.push(c));
      doc.on("end", () => resolve(Buffer.concat(chunks)));

      doc.fontSize(16).text(`Bilan de kinésithérapie — ${patient}`, { align: "left" });
      doc.moveDown();
      doc.fontSize(11).text(plainText, { align: "left" });
      doc.moveDown();
      doc.fontSize(8).text(
        "Consentement d’enregistrement recueilli. Audio supprimé après génération.",
        { align: "left" }
      );
      doc.end();
    });

    // Upload PDF dans Supabase
    const pdfPath = `reports/${crypto.randomUUID()}.pdf`;
    const { error: pdfErr } = await supabaseServer.storage
      .from("pdf")
      .upload(pdfPath, pdfBuffer, {
        contentType: "application/pdf",
        upsert: false,
      });
    if (pdfErr) throw pdfErr;

    const { data: signed } = await supabaseServer.storage
      .from("pdf")
      .createSignedUrl(pdfPath, 60 * 60);

    // Email (optionnel)
    if (sendTo) {
      const to = sendTo.split(",").map((s) => s.trim()).filter(Boolean);
      try {
        await sendEmail(to, patient, pdfBuffer);
      } catch (err) {
        console.error("Erreur envoi email:", err);
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
    return NextResponse.json(
      { error: e.message || "Erreur serveur" },
      { status: 500 }
    );
  }
}
