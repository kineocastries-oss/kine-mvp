import { NextRequest, NextResponse } from 'next/server';
import OpenAI from 'openai';
import { supabaseServer } from "@/lib/supabase";
import { systemPrompt, userPrompt } from "@/lib/prompt";

import PDFDocument from 'pdfkit';
import { Resend } from 'resend';
import { marked } from 'marked';

export async function POST(req: NextRequest) {
  try {
    const { patient, transcription } = await req.json();

    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

    // Génération du contenu bilan
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt.replace("{TRANSCRIPTION}", transcription) },
      ],
    });

    const markdown = completion.choices[0].message.content || "";

    // 🔑 Correction du bug : forcer en string
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

    // Stockage du PDF dans Supabase
    const { data, error } = await supabaseServer.storage
      .from("bilans")
      .upload(`bilans/${patient}-${Date.now()}.pdf`, pdfBuffer, {
        contentType: "application/pdf",
        upsert: true,
      });

    if (error) throw error;

    return NextResponse.json({ success: true, data });
  } catch (error: any) {
    console.error(error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
