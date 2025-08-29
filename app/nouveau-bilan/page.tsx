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

  // Id technique (dossier pour ranger les segments dans Storage)
  const [consultationId] = useState<string>(() => crypto.randomUUID());

  const handleAudioChange = useCallback((paths: string[]) => {
    // on reçoit des chemins "audio/<id>/seg-X.webm"
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
      set


