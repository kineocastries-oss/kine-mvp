"use client";

import Link from "next/link";

export default function Home() {
  return (
    <main
      style={{
        padding: "2rem",
        maxWidth: 900,
        margin: "0 auto",
        display: "grid",
        gap: "1.5rem",
      }}
    >
      {/* En-tête */}
      <header style={{ display: "grid", gap: 8 }}>
        <h1 style={{ margin: 0, fontSize: 32 }}>Bilan Kiné</h1>
        <p style={{ margin: 0, color: "#555" }}>
          Présentation de l’application <strong>GPT‑Kiné</strong> — enregistre l’entretien,
          génère un bilan clair, et exporte le PDF.
        </p>
      </header>

      {/* Bloc de présentation */}
      <section
        style={{
          border: "1px solid #e5e7eb",
          borderRadius: 12,
          padding: 16,
          background: "#fafafa",
        }}
      >
        <h2 style={{ marginTop: 0, marginBottom: 8 }}>Présentation</h2>
        <ul style={{ margin: 0, paddingLeft: 18, lineHeight: 1.6 }}>
          <li>Enregistrement audio multi‑segments durant l’anamnèse.</li>
          <li>Transcription &amp; synthèse automatique en français pro.</li>
          <li>Génération d’un PDF structuré (anamnèse, examen, objectifs…).</li>
          <li>Partage du bilan par e‑mail (kiné et patient).</li>
        </ul>
      </section>

      {/* Appel à l’action */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
          justifyContent: "space-between",
          border: "1px solid #e5e7eb",
          borderRadius: 12,
          padding: 16,
        }}
      >
        <div>
          <h3 style={{ margin: "0 0 6px 0" }}>Démarrer un nouveau bilan</h3>
          <p style={{ margin: 0, color: "#666" }}>
            Cliquez pour ouvrir l’interface d’enregistrement et de génération PDF.
          </p>
        </div>

        <Link href="/nouveau-bilan">
          <button
            type="button"
            style={{
              padding: "10px 16px",
              borderRadius: 8,
              border: "1px solid #1d4ed8",
              background: "#2563eb",
              color: "white",
              cursor: "pointer",
              fontWeight: 600,
            }}
          >
            🚀 Aller vers Nouveau Bilan
          </button>
        </Link>
      </div>

      {/* Pied de page mini */}
      <footer style={{ color: "#888", fontSize: 12 }}>
        GPT‑Kiné • MVP démo — Génération automatique de bilans à partir d’enregistrements.
      </footer>
    </main>
  );
}

