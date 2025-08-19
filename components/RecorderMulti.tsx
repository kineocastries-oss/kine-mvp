'use client';
import { useEffect, useRef, useState } from 'react';

export default function RecorderMulti() {
  const [patient, setPatient] = useState('');
  const [clinicianEmail, setClinicianEmail] = useState('demo@demo');
  const [sendTo, setSendTo] = useState('');
  const [segments, setSegments] = useState<Blob[]>([]);
  const [recording, setRecording] = useState(false);
  const [consent, setConsent] = useState(false);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const stopTimerRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (mediaRecorderRef.current?.state === 'recording') mediaRecorderRef.current.stop();
      if (stopTimerRef.current) window.clearTimeout(stopTimerRef.current);
    };
  }, []);

  const startSegment = async () => {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const mr = new MediaRecorder(stream, { mimeType: 'audio/webm' });
    chunksRef.current = [];
    mr.ondataavailable = (e) => { if (e.data.size > 0) chunksRef.current.push(e.data); };
    mr.onstop = async () => {
      const blob = new Blob(chunksRef.current, { type: 'audio/webm' });
      setSegments(prev => [...prev, blob]);
      setRecording(false);
    };
    mr.start();
    mediaRecorderRef.current = mr;
    setRecording(true);
    // Auto-stop à 5 minutes
    stopTimerRef.current = window.setTimeout(() => {
      if (mediaRecorderRef.current?.state === 'recording') mediaRecorderRef.current.stop();
    }, 5 * 60 * 1000);
  };

  const stopNow = () => {
    if (stopTimerRef.current) window.clearTimeout(stopTimerRef.current);
    mediaRecorderRef.current?.stop();
  };

  const removeSegment = (idx: number) => {
    setSegments(prev => prev.filter((_, i) => i !== idx));
  };

  const submitAll = async () => {
    if (!consent) { alert("Coche le consentement patient avant d'envoyer."); return; }
    if (segments.length === 0) { alert("Ajoute au moins un segment d'enregistrement."); return; }

    const form = new FormData();
    segments.forEach((blob, i) => form.append('audios', blob, `seg-${i+1}.webm`));
    form.append('patient', patient || 'Patient');
    form.append('clinician_email', clinicianEmail);
    form.append('send_to', sendTo);

    const res = await fetch('/api/process', { method: 'POST', body: form });
    const out = await res.json();
    if (out.pdfUrl) window.open(out.pdfUrl, '_blank');
    else alert('Erreur: ' + (out.error || 'inconnue'));
  };

  return (
    <div className="space-y-4">
      <div>
        <label>Nom du patient</label>
        <input className="border p-2 ml-2" value={patient} onChange={e=>setPatient(e.target.value)} placeholder="Ex: Martine Bernier" />
      </div>
      <div>
        <label>Votre e‑mail (kiné)</label>
        <input className="border p-2 ml-2" value={clinicianEmail} onChange={e=>setClinicianEmail(e.target.value)} placeholder="vous@cabinet.fr" />
      </div>
      <div>
        <label>Destinataires e‑mail (optionnel)</label>
        <input className="border p-2 ml-2 w-full" value={sendTo} onChange={e=>setSendTo(e.target.value)} placeholder="medecin@exemple.fr, patient@mail.com" />
      </div>

      <p className="text-sm text-gray-700">
        Enregistre **plusieurs segments de 5 min max**, puis clique “Générer le PDF”.
      </p>

      <div className="flex gap-2">
        {!recording && <button onClick={startSegment} className="bg-black text-white px-4 py-2">+ Nouveau segment (max 5 min)</button>}
        {recording && <button onClick={stopNow} className="bg-red-600 text-white px-4 py-2">Stopper maintenant</button>}
        <button
          onClick={submitAll}
          className="bg-blue-600 text-white px-4 py-2 disabled:opacity-50"
          disabled={recording}
        >
          Générer le PDF (transcrire & synthèse)
        </button>
      </div>

      <div className="border rounded p-3">
        <b>Segments ajoutés :</b>
        <ul className="list-disc pl-5">
          {segments.map((_, i) => (
            <li key={i} className="flex items-center gap-2">
              Segment {i+1}
              <button onClick={() => removeSegment(i)} className="text-red-600 underline">supprimer</button>
            </li>
          ))}
          {segments.length === 0 && <li>Aucun segment</li>}
        </ul>
      </div>

      <label className="block">
        <input type="checkbox" checked={consent} onChange={e=>setConsent(e.target.checked)} /> J’ai obtenu le consentement du patient (audio supprimé après génération).
      </label>
    </div>
  );
}
