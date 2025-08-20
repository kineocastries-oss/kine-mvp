import { NextRequest, NextResponse } from 'next/server';
import OpenAI from 'openai';

// chemins relatifs depuis app/api/process/route.ts
import { supabaseServer } from '../../../lib/supabase';
import { systemPrompt, userPrompt } from '../../../lib/prompt';

import PDFDocument from 'pdfkit';
import { Resend } from 'resend';
import { marked } from 'marked';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const resend = new Resend(process.env.RESEND_API_KEY);

export async function POST(req: NextRequest) {
  try {
    const form = await req.formData();
    const patient = String(form.get('patient') || 'Patient');
    const clinicianEmail = String(form.get('clinician_email') || 'demo@demo');
    const sendTo = String(form.get('send_to') || '');

    // Récupère tous les fichiers 'audios'
    const files = form.getAll('audios').filter(f => f instanceof File) as File[];
    if (files.length === 0) {
      return NextResponse.json({ error: 'Aucun fichier audio' }, { status: 400 });
    }

    // Upload + transcription segment par segment
    const transcriptParts: string[] = [];

    for (const file of files) {
      const arrayBuf = await file.arrayBuffer();
      const buffer = Buffer.from(arrayBuf);
      const audioPath = `raw/${crypto.randomUUID()}.webm`;

      const { error: upErr } = await supabaseServer.storage.from('audio').upload(audioPath, buffer, {
        contentType: file.type || 'audio/webm',
        upsert: false,
      });
      if (upErr) throw upErr;

      const tr = await openai.audio.transcriptions.create({
        file: new File([buffer], 'audio.webm', { type: 'audio/webm' }) as any,
        model: 'whisper-1',
        language: 'fr',
      });
      const text = (tr as any).text || '';
      if (text) transcriptParts.push(text);

      // purge audio après transcription
      await supabaseServer.storage.from('audio').remove([audioPath]);
    }

    const transcriptText = transcriptParts.join('\n\n---\n\n');

    // Synthèse globale (➡️ userPrompt est une fonction)
    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      temperature: 0.2,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt(transcriptText, patient) },
      ],
    });

    const full = completion.choices[0]?.message?.content || '';
    const jsonStart = full.indexOf('{');
    const jsonEnd = full.lastIndexOf('}');
    const jsonStr = jsonStart >= 0 ? full.slice(jsonStart, jsonEnd + 1) : '{}';
    let schemaJson: any = {};
    try {
      schemaJson = JSON.parse(jsonStr);
    } catch {
      // ignore JSON parse error, we'll continue with markdown only
    }
    const markdown = full.slice(jsonEnd + 1).trim();

    // Convertir Markdown → (HTML string) → texte brut (pour PDFKit)
    const html = marked.parse(markdown) as string; // <— forcer en string
    const plainText = html
      .replace(/<[^>]+>/g, '')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&');

    // PDF
    const pdfBuffer = await new Promise<Buffer>((resolve) => {
      const doc = new PDFDocument({ margin: 40 });
      const chunks: Buffer[] = [];
      doc.on('data', (c) => chunks.push(c));
      doc.on('end', () => resolve(Buffer.concat(chunks)));

      doc.fontSize(16).text(`Bilan de kinésithérapie — ${patient}`, { align: 'left' });
      doc.moveDown();

      doc.fontSize(11).text(plainText, { align: 'left' });

      doc.moveDown();
      doc
        .fontSize(8)
        .text("Consentement d’enregistrement recueilli. Audio supprimé après génération.", {
          align: 'left',
        });
      doc.end();
    });

    // Upload PDF
    const pdfPath = `reports/${crypto.randomUUID()}.pdf`;
    const { error: pdfErr } = await supabaseServer.storage.from('pdf').upload(pdfPath, pdfBuffer, {
      contentType: 'application/pdf',
      upsert: false,
    });
    if (pdfErr) throw pdfErr;

    const { data: signed } = await supabaseServer.storage.from('pdf').createSignedUrl(pdfPath, 60 * 60);

    // Email (optionnel)
    if (sendTo) {
      const to = sendTo.split(',').map((s) => s.trim()).filter(Boolean);
      try {
        await resend.emails.send({
          from: process.env.SENDER_EMAIL!,
          to,
          subject: `Bilan kinésithérapie – ${patient}`,
          html: `<p>Bonjour,</p><p>Voici le bilan (lien valable 1h) :</p><p><a href="${signed?.signedUrl}">Télécharger le PDF</a></p>`,
          attachments: [{ filename: `Bilan-${patient}.pdf`, content: pdfBuffer.toString('base64') }],
        });
      } catch {
        // on ne bloque pas le flux si l'email échoue
      }
    }

    return NextResponse.json({ ok: true, pdfUrl: signed?.signedUrl, patient, json: schemaJson });
  } catch (e: any) {
    console.error(e);
    return NextResponse.json({ error: e.message || 'Erreur serveur' }, { status: 500 });
  }
}

