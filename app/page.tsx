"use client";

import { useState } from "react";

export default function NouveauBilanPage() {
  const [consultationId, setConsultationId] = useState("demo123"); // à remplacer par ton vrai id
  const [patientName, setPatientName] = useState("");
  const [emailKine, setEmailKine] = useState("");
  const [emailPatient, setEmailPatient] = useState("");
  const [audioPaths, setAudioPaths] = useState<string[]>([]); // ex: ['audio/demo123/seg1.webm']
  const [loading, setLoading] = useState(false);
  const [reportUrl, setReportUrl] = useState<string | null>(null);

  async function onGeneratePdf() {
    try {
      setLoading(true);
      const res = await fetch("/api/generatePdf", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          consultationId,
          patientName,
          emailKine,
          emailPatient: emailPatient || null,
          audioPaths,
        }),
      });

      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Échec génération");

      setReportUrl(json.url || null);
      alert("✅ PDF généré avec succès !");
    } catch (err: any) {
      alert(err.message || "Erreur inconnue lors de la génération du PDF");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main style={{ padding: "2rem" }}>
      <h1>Nouveau Bilan 📝</h1>

      <div style={{ marginBottom: "1rem" }}>
        <label>Nom du patient : </label>
        <input
          value={patientName}
          onChange={(e) => setPatientName(e.target.value)}
          placeholder="Nom"
          style={{ marginLeft: "0.5rem" }}
        />
      </div>

      <div style={{ marginBottom: "1rem" }}>
        <label>Email kiné (obligatoire) : </label>
        <input
          value={emailKine}
          onChange={(e) => setEmailKine(e.target.value)}
          placeholder="exemple@kine.fr"
          style={{ marginLeft: "0.5rem" }}
        />
      </div>

      <div style={{ marginBottom: "1rem" }}>
        <label>Email patient (optionnel) : </label>
        <input
          value={emailPatient}
          onChange={(e) => setEmailPatient(e.target.value)}
          placeholder="exemple@patient.fr"
          style={{ marginLeft: "0.5rem" }}
        />
      </div>

      {/* Ici tu pourras ajouter ton composant RecorderMulti qui alimente audioPaths */}

      <button onClick={onGeneratePdf} disabled={loading}>
        {loading ? "⏳ Génération en cours..." : "📄 Générer PDF"}
      </button>

      {reportUrl && (
        <p style={{ marginTop: "1rem" }}>
          <a href={reportUrl} target="_blank" rel="noreferrer">
            🔗 Télécharger le PDF
          </a>
        </p>
      )}
    </main>
  );
}
