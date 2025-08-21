"use client";

import { useCallback, useMemo, useState } from "react";
import RecorderMulti from "../../components/RecorderMulti";

export default function NouveauBilanPage() {
  const [patientName, setPatientName] = useState("");
  const [emailKine, setEmailKine] = useState("");
  const [emailPatient, setEmailPatient] = useState("");
  const [audioPaths, setAudioPaths] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [reportUrl, setReportUrl] = useState<string | null>(null);
  const [consultationId] = useState<string>(() => crypto.randomUUID());

  // DEBUG flags
  const hasWindow = typeof window !== "undefined";
  const hasNavigator = typeof navigator !== "undefined";
  const hasMediaDevices = hasNavigator && "mediaDevices" in navigator;
  const hasGetUserMedia =
    hasMediaDevices && typeof (navigator as any).mediaDevices.getUserMedia === "function";
  const envUrl = typeof process !== "undefined" ? !!process.env.NEXT_PUBLIC_SUPABASE_URL : false;
  const envAnon = typeof process !== "undefined" ? !!process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY : false;

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
          audioPaths,
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
    <main style={{ padding: "2rem", maxWidth: 820, margin: "0 auto" }}>
      <h1 style={{ marginBottom: 16 }}>Nouveau Bilan 📝</h1>

      {/* Panneau DEBUG visible */}
      <div style={{ padding: 12, border: "1px dashed #aaa", borderRadius: 8, marginBottom: 16 }}>
        <div><strong>DEBUG</strong></div>
        <div>window: {String(hasWindow)} | navigator: {String(hasNavigator)}</div>
        <div>mediaDevices: {String(hasMediaDevices)} | getUserMedia: {String(hasGetUserMedia)}</div>
        <div>ENV NEXT_PUBLIC_SUPABASE_URL: {String(envUrl)} | NEXT_PUBLIC_SUPABASE_ANON_KEY: {String(envAnon)}</div>
        <div>Segments: {audioPaths.length}</div>
      </div>

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

      {/* Enregistreur */}
      <section style={{ border: "1px solid #ddd", borderRadius: 8, padding: 16, marginBottom: 16 }}>
        <h2 style={{ marginTop: 0, marginBottom: 8 }}>Enregistrement 🎙️</h2>

        <RecorderMulti
          onChange={handleAudioChange

