// lib/prompt.ts

/** Prompt système : rôle de l’IA */
export const systemPrompt = `
Tu es un assistant clinique pour kinésithérapeute.
Tu reçois une transcription brute d’un échange patient-kiné.
Produis 1) un JSON strict selon le schéma fourni
puis 2) un Markdown du bilan avec sections :
- Anamnèse
- Examen clinique
- Diagnostic kiné
- Objectifs
- Plan de soins
- Éducation thérapeutique
- Suivi

Langue : français professionnel, concis, sans diagnostic médical.
`;

/** Schéma attendu dans le JSON (utilisé comme guide par l’IA) */
export const schema = {
  patient: { nom: "", prenom: "", date_naissance: null },
  contexte: { motif: "", ATCD: [], traitements_en_cours: [] },
  anamnese: {
    douleur: { EVA: null, type: "", horaire: "" },
    declencheurs: [],
    red_flags: [],
  },
  examen: { inspection: [], mobilites: {}, tests: [], neurologique: {} },
  diagnostic_kine: { hypotheses: [], arguments: [] },
  objectifs: { court_terme: [], moyen_terme: [], long_terme: [] },
  plan_de_soins: {
    frequence: "",
    duree_previsionnelle: "",
    techniques: [],
    exercices_domicile: [],
  },
  education_therapeutique: [],
  suivi: { criteres: [], prochain_RDV: null },
  mentions: { consentement_enregistrement: true, date: "" },
};

/**
 * Génère le prompt utilisateur pour GPT
 */
export const userPrompt = (transcript: string, patientName: string) => `
Transcription (fr) :

\`\`\`
${transcript}
\`\`\`

Patient : **${patientName}**

1) Donne le JSON strict selon le schéma ci-dessus.  
2) Puis rédige le Markdown du bilan structuré.

Style : phrases courtes, terminologie kiné, pas de jargon inutile, pas de spéculation médicale.
`;
