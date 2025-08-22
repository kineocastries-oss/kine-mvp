export type BilanInput = {
  patient?: {
    nomPrenom?: string;
    age?: string | number;
    situation?: string;
    travail?: string;
    loisirs?: string;
    antecedents?: string;
  };
  motif?: {
    raison?: string;
    contexte?: string;
    examens?: string;
    parcours?: string;
  };
  evaluation?: {
    douleur?: string;
    incapacites?: string;
    observation?: string;
    tests?: string;
    facteurs?: string;
  };
  explications?: {
    origine?: string;
    lien?: string;
    comprehension?: string;
  };
  plan?: {
    objectifs?: string;
    techniques?: string;
    frequenceDuree?: string;
  };
};
