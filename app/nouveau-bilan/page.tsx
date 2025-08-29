"use client";

import { useCallback, useMemo, useState } from "react";
import RecorderMulti from "../../components/RecorderMulti"; // vérifie le chemin

export default function NouveauBilanPage() {
  // ---- Champs du formulaire
  const [patientName, setPatientName] = useState("");
  const [emailKine, setEmailKine] = useState("");
  const [emailPatient, setEmailPatient] = useState("");

  // ---- Enregistrements
  const [audioPaths, setAudioPaths] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [reportUrl, setReportUrl] = useState<string | null>(null);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);

  // Id technique (dossier pour ranger les segments dans Storage)
  const [consultationId] = useState<string>(() => crypto.randomUUID());

  const handleAudioChange = useCallback((paths: string[]) => {
    setAudioPaths(paths);
  }, []);

  const emailRegex = /\S+@\S+\.\S+/;

  const canGenerate = useMemo(() => {
    const emailOK = emailRegex.test(emailKine);
    return emailOK && audioPaths.length > 0 && !loading;
  }, [emailKine, audioPaths.length, loading]);

  async function onGeneratePdf() {
    try {
      setLoading(true);
      setReportUrl(null);
      setStatusMsg("⏳ Génération du PDF et envoi de l'e-mail en cours...");

      const res = await fetch("/api/generatePdf", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          consultationId,
          patientName,
          emailKine,
          emailPatient: emailPatient || undefined,
          audioPaths,
          sendEmailToKine: true,
        }),
      });

      const json = await res.json();
      if (!res.ok || !json?.ok) {
        throw new Error(json?.error || "Échec génération/envoi");
      }

      setReportUrl(json.url || null);

      const email = json.email;
      if (email?.sent) {
        setStatusMsg(
          `✅ PDF généré et e-mail envoyé.\nDestinataires : ${(email.to || []).join(
            ", "
          )}\nID Resend : ${email.id || "n/a"}`
        );
      } else {
        setStatusMsg(
          `⚠️ PDF généré, mais l'e-mail n'a pas été envoyé.\n` +
            `Destinataires : ${(email?.to || []).join(", ") || "aucun"}\n` +
            `Raison : ${email?.error || "inconnue"}`
        );
      }
    } catch (err: any) {
      setStatusMsg(`❌ Erreur : ${err?.message || "inconnue"}`);
    } finally {
      setLoading(false);
    }
  }

  return (
    <main style={{ padding: "2rem", maxWidth: 820, margin: "0 auto" }}>
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
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: 12,
          marginBottom: 12,
        }}
      >
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
          <label style={{ display: "block", marginBottom: 6 }}>
            Email patient (optionnel)
          </label>
          <input
            value={emailPatient}
            onChange={(e) => setEmailPatient(e.target.value)}
            placeholder="patient@email.fr"
            style={{ width: "100%", padding: 8 }}
          />
        </div>
      </div>

      {/* Enregistreur multi-segments */}
      <section
        style={{
          border: "1px solid #ddd",
          borderRadius: 8,
          padding: 16,
          marginBottom: 16,
        }}
      >
        <h2 style={{ marginTop: 0, marginBottom: 8 }}>Enregistrement 🎙️</h2>

        <RecorderMulti
          onChange={handleAudioChange}
          consultationId={consultationId}
          bucket="audio"
        />

        {/* Aperçu segments */}
        <div style={{ marginTop: 12, fontSize: 14 }}>
          <strong>Segments :</strong> {audioPaths.length}
          {audioPaths.length > 0 && (
            <ul style={{ marginTop: 8 }}>
              {audioPaths.map((p) => (
                <li key={p} style={{ wordBreak: "break-all" }}>
                  {p}
                </li>
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

      {/* Zone de statut */}
      {statusMsg && (
        <pre
          style={{
            marginTop: 16,
            padding: "12px",
            background: "#f8f8f8",
            border: "1px solid #ddd",
            borderRadius: 8,
            whiteSpace: "pre-wrap",
          }}
        >
          {statusMsg}
        </pre>
      )}

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
