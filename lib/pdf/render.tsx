import React from "react";
import { renderToBuffer } from "@react-pdf/renderer";
import BilanPdf from "@/components/pdf/BilanPdf";
import type { Section } from "@/lib/bilan/normalize";

export async function renderBilanPdf(sections: Section[]): Promise<Buffer> {
  const element = <BilanPdf sections={sections} />;
  return await renderToBuffer(element);
}
