"use client";

import { useCallback, useMemo, useState } from "react";
import RecorderMulti from "../../components/RecorderMulti";


export default function NouveauBilanPage() {
  // ---- Champs du formulaire
  const [patientName, setPatientName] = useState("");
  const [emailKine, setEmailKine] = useState("");
  const [emailPatient, setEmailPatient] = useState("");

  // ---- Segments audio (chemins Supabase "audio/...")
  const [audioPaths, setAudioPaths] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [reportUrl, setReportUrl] = useState<string | null>(null);

  // Id “technique” du bilan (si tu as déjà une table, remplace par son vrai id)
  const [consultationId] = useState<string>(() => crypto.randomUUID());

  // ---- Callback appelé par RecorderMulti quand la liste des segments change
  const handleAudioChange = useCallback((paths: string[]) => {
    setAudioPaths(paths);
  }, []);

  const canGenerate = useMemo(() => {
    const emailOK = /\S+@\S+\.\S+/.test(emailKine);
    return emailOK && audioPaths.length > 0 && !loading;
  }, [emailKine, audioPaths.length, loading]);

  async function onGeneratePdf() {
    try {
      setLoading(true);
      setReportUrl(null);

      const res = await fetch("/api/generatePdf", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          consultationId,
          patientName,
          emailKine,
          emailPatient: emailPatient || null,
          audioPaths, // ex: ["audio/<id>/seg1.webm", ...] — RecorderMulti doit remplir ça
        }),
      });

      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Échec génération PDF");

      setReportUrl(json.url || null);
      alert("✅ PDF généré !");
    } catch (err: any) {
      alert(err.message || "Erreur inconnue");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main style={{ padding: "2rem", maxWidth: 720, margin: "0 auto" }}>
      <h1 style={{ marginBottom: 16 }}>Nouveau Bilan 📝</h1>

      {/* Patient */}
      <div style={{ marginBottom: 12 }}>
        <label style={{ display: "block", marginBottom: 6 }}>Nom du patient</label>
        <input
          value={patientName}
          onChange={(e) => setPatientName(e.target.value)}
          placeholder="Ex : Robert Dupont"
          style={{ width: "100%", padding: 8 }}
        />
      </div>

      {/* Emails */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 12 }}>
        <div>
          <label style={{ display: "block", marginBottom: 6 }}>
            Email kiné <span style={{ color: "crimson" }}>*</span>
          </label>
          <input
            value={emailKine}
            onChange={(e) => setEmailKine(e.target.value)}
            placeholder="kine@cabinet.fr"
            style={{ width: "100%", padding: 8 }}
          />
        </div>
        <div>
          <label style={{ display: "block", marginBottom: 6 }}>Email patient (optionnel)</label>
          <input
            value={emailPatient}
            onChange={(e) => setEmailPatient(e.target.value)}
            placeholder="patient@email.fr"
            style={{ width: "100%", padding: 8 }}
          />
        </div>
      </div>

      {/* Enregistreur multi-segments */}
      <section style={{ border: "1px solid #ddd", borderRadius: 8, padding: 16, marginBottom: 16 }}>
        <h2 style={{ marginTop: 0, marginBottom: 8 }}>Enregistrement 🎙️</h2>

        {/*
          IMPORTANT :
          - RecorderMulti doit appeler "onChange" (ou un prop équivalent) avec la liste des chemins Supabase
            après chaque ajout/suppression d'un segment.
          - Si ton composant a une autre API, adapte juste le nom des props.
        */}
        <RecorderMulti
          onChange={handleAudioChange}
          consultationId={consultationId} // pratique si RecorderMulti range par dossier "audio/<id>/..."
          bucket="audio"                  // si ton composant a ce paramètre
        />

        {/* Aperçu segments */}
        <div style={{ marginTop: 12, fontSize: 14 }}>
          <strong>Segments :</strong> {audioPaths.length}
          {audioPaths.length > 0 && (
            <ul style={{ marginTop: 8 }}>
              {audioPaths.map((p) => (
                <li key={p} style={{ wordBreak: "break-all" }}>{p}</li>
              ))}
            </ul>
          )}
        </div>
      </section>

      {/* Bouton génération */}
      <button
        onClick={onGeneratePdf}
        disabled={!canGenerate}
        style={{
          padding: "10px 16px",
          cursor: canGenerate ? "pointer" : "not-allowed",
          opacity: canGenerate ? 1 : 0.5,
        }}
      >
        {loading ? "⏳ Génération en cours..." : "📄 Générer le PDF"}
      </button>

      {/* Lien de téléchargement */}
      {reportUrl && (
        <p style={{ marginTop: 14 }}>
          <a href={reportUrl} target="_blank" rel="noreferrer">
            🔗 Télécharger le PDF
          </a>
        </p>
      )}
    </main>
  );
}
