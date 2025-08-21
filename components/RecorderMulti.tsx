"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createClient, SupabaseClient } from "@supabase/supabase-js";

type Props = {
  onChange?: (paths: string[]) => void;
  /** dossier technique pour ranger les segments (ex: id de consultation) */
  consultationId?: string;
  /** nom du bucket Storage (par défaut "audio") */
  bucket?: string;
};

type Segment = {
  path: string;     // chemin Storage (ex: audio/<id>/seg-1.webm)
  url?: string;     // URL signée (optionnel pour écoute locale)
  size?: number;    // bytes
};

export default function RecorderMulti({
  onChange,
  consultationId,
  bucket = "audio",
}: Props) {
  const [supported, setSupported] = useState<boolean>(false);
  const [recording, setRecording] = useState<boolean>(false);
  const [segments, setSegments] = useState<Segment[]>([]);
  const [counter, setCounter] = useState<number>(0);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);

  // ---- Supabase client (client-side, anon) ----
  const supabaseRef = useRef<SupabaseClient | null>(null);
  useEffect(() => {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
    const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
    supabaseRef.current = createClient(url, anon);
  }, []);

  // Vérifier support navigateur
  useEffect(() => {
    setSupported(typeof window !== "undefined" && !!navigator.mediaDevices && !!window.MediaRecorder);
  }, []);

  // Notifier le parent à chaque changement de liste
  useEffect(() => {
    onChange?.(segments.map((s) => s.path));
  }, [segments, onChange]);

  const startRecording = useCallback(async () => {
    if (!supported) return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mr = new MediaRecorder(stream, { mimeType: "audio/webm" });
      chunksRef.current = [];

      mr.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) chunksRef.current.push(e.data);
      };

      mr.onstop = async () => {
        const blob = new Blob(chunksRef.current, { type: "audio/webm" });
        await saveSegment(blob);
        // stop tracks
        stream.getTracks().forEach((t) => t.stop());
      };

      mediaRecorderRef.current = mr;
      mr.start();
      setRecording(true);
    } catch (e) {
      alert("Impossible d'accéder au micro : " + (e as any)?.message ?? e);
    }
  }, [supported]);

  const stopRecording = useCallback(() => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
      mediaRecorderRef.current.stop();
    }
    setRecording(false);
  }, []);

  const saveSegment = useCallback(async (blob: Blob) => {
    const supabase = supabaseRef.current!;
    const id = consultationId || "session";
    const next = counter + 1;
    const path = `${id}/seg-${next}.webm`; // chemin relatif DANS le bucket
    const fullPath = `${bucket}/${path}`;  // affichage friendly

    // Upload dans le bucket
    const { error } = await supabase.storage.from(bucket).upload(path, blob, {
      contentType: "audio/webm",
      upsert: false,
    });
    if (error) {
      alert("Upload audio échoué : " + error.message);
      return;
    }

    // Optionnel: URL signée pour écoute immédiate (30 min)
    const { data: signed } = await supabase.storage.from(bucket).createSignedUrl(path, 60 * 30);

    setCounter(next);
    setSegments((prev) => [
      ...prev,
      { path: `${bucket}/${path}`, url: signed?.signedUrl, size: blob.size },
    ]);
  }, [bucket, consultationId, counter]);

  const removeLast = useCallback(async () => {
    const supabase = supabaseRef.current!;
    setSegments(async (prev) => {
      if (prev.length === 0) return prev;
      const last = prev[prev.length - 1];
      // last.path est "audio/<id>/seg-X.webm" -> on enlève le prefix bucket + "/"
      const relative = last.path.startsWith(`${bucket}/`)
        ? last.path.slice(bucket.length + 1)
        : last.path;
      await supabase.storage.from(bucket).remove([relative]);
      setCounter((n) => Math.max(0, n - 1));
      return prev.slice(0, -1);
    });
  }, [bucket]);

  return (
    <div>
      {!supported && (
        <p style={{ color: "crimson" }}>
          Votre navigateur ne supporte pas l’enregistrement audio (MediaRecorder).
        </p>
      )}

      <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
        {!recording ? (
          <button onClick={startRecording} disabled={!supported}>
            🎙️ Démarrer l’enregistrement
          </button>
        ) : (
          <button onClick={stopRecording}>⏹️ Arrêter</button>
        )}
        <button onClick={removeLast} disabled={segments.length === 0}>
          🧹 Supprimer le dernier segment
        </button>
      </div>

      <div style={{ fontSize: 14, color: "#555" }}>
        Segments: <strong>{segments.length}</strong>
      </div>

      {segments.length > 0 && (
        <ul style={{ marginTop: 8 }}>
          {segments.map((s, i) => (
            <li key={s.path + i} style={{ wordBreak: "break-all" }}>
              {s.path}
              {s.url && (
                <>
                  {" "}
                  —{" "}
                  <audio controls src={s.url} style={{ verticalAlign: "middle" }}>
                    Votre navigateur ne supporte pas la lecture audio.
                  </audio>
                </>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
