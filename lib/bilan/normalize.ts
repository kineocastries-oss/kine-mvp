import { BilanInput } from "./schema";

type Line = { label: string; value: string };
export type Section = { title: string; lines: Line[] };

const nonEmpty = (s?: string | number | null) =>
  s !== undefined && s !== null && String(s).trim().length > 0;

export function buildSections(input: BilanInput): Section[] {
  const sections: Section[] = [];

  // 1. Informations patient
  const patientLines: Line[] = [];
  if (nonEmpty(input.patient?.nomPrenom)) patientLines.push({ label: "Nom et prénom", value: String(input.patient!.nomPrenom) });
  if (nonEmpty(input.patient?.age)) patientLines.push({ label: "Âge", value: String(input.patient!.age) });
  if (nonEmpty(input.patient?.situation)) patientLines.push({ label: "Situation familiale", value: String(input.patient!.situation) });
  if (nonEmpty(input.patient?.travail)) patientLines.push({ label: "Activité professionnelle", value: String(input.patient!.travail) });
  if (nonEmpty(input.patient?.loisirs)) patientLines.push({ label: "Activités sociales et loisirs", value: String(input.patient!.loisirs) });
  if (nonEmpty(input.patient?.antecedents)) patientLines.push({ label: "Antécédents médicaux importants", value: String(input.patient!.antecedents) });
  if (patientLines.length) sections.push({ title: "Informations patient", lines: patientLines });

  // 2. Motif de consultation
  const motifLines: Line[] = [];
  if (nonEmpty(input.motif?.raison)) motifLines.push({ label: "Raison de la venue", value: String(input.motif!.raison) });
  if (nonEmpty(input.motif?.contexte)) motifLines.push({ label: "Contexte d’apparition", value: String(input.motif!.contexte) });
  if (nonEmpty(input.motif?.examens)) motifLines.push({ label: "Examens complémentaires", value: String(input.motif!.examens) });
  if (nonEmpty(input.motif?.parcours)) motifLines.push({ label: "Parcours de soins déjà réalisé", value: String(input.motif!.parcours) });
  if (motifLines.length) sections.push({ title: "Motif de consultation", lines: motifLines });

  // 3. Évaluation clinique
  const evalLines: Line[] = [];
  if (nonEmpty(input.evaluation?.douleur)) evalLines.push({ label: "Douleur", value: String(input.evaluation!.douleur) });
  if (nonEmpty(input.evaluation?.incapacites)) evalLines.push({ label: "Incapacités fonctionnelles", value: String(input.evaluation!.incapacites) });
  if (nonEmpty(input.evaluation?.observation)) evalLines.push({ label: "Observation clinique", value: String(input.evaluation!.observation) });
  if (nonEmpty(input.evaluation?.tests)) evalLines.push({ label: "Tests spécifiques", value: String(input.evaluation!.tests) });
  if (nonEmpty(input.evaluation?.facteurs)) evalLines.push({ label: "Facteurs aggravants ou de risque", value: String(input.evaluation!.facteurs) });
  if (evalLines.length) sections.push({ title: "Évaluation clinique", lines: evalLines });

  // 4. Explications données au patient
  const expLines: Line[] = [];
  if (nonEmpty(input.explications?.origine)) expLines.push({ label: "Origine probable du trouble", value: String(input.explications!.origine) });
  if (nonEmpty(input.explications?.lien)) expLines.push({ label: "Lien avec son mode de vie ou antécédents", value: String(input.explications!.lien) });
  if (nonEmpty(input.explications?.comprehension)) expLines.push({ label: "Éléments de compréhension", value: String(input.explications!.comprehension) });
  if (expLines.length) sections.push({ title: "Explications données au patient", lines: expLines });

  // 5. Plan de traitement
  const planLines: Line[] = [];
  if (nonEmpty(input.plan?.objectifs)) planLines.push({ label: "Objectifs principaux", value: String(input.plan!.objectifs) });
  if (nonEmpty(input.plan?.techniques)) planLines.push({ label: "Techniques envisagées", value: String(input.plan!.techniques) });
  if (nonEmpty(input.plan?.frequenceDuree)) planLines.push({ label: "Fréquence et durée", value: String(input.plan!.frequenceDuree) });
  if (planLines.length) sections.push({ title: "Plan de traitement", lines: planLines });

  return sections;
}
