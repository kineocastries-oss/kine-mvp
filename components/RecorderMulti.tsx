"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { createClient, SupabaseClient } from "@supabase/supabase-js";

type RecorderMultiProps = {
  onChange?: (paths: string[]) => void;
  consultationId: string; // dossier technique pour ranger les segments
  bucket: string;         // typiquement "audio"
};

type Segment = {
  storagePath: string; // ex: "audio/<id>/seg-1.webm"
  signedUrl?: string;  // URL signée temporaire pour écoute
  size: number;
};

export default function RecorderMulti({
  onChange,
  consultationId,
  bucket,
}: RecorderMultiProps) {
  const [supported, setSupported] = useState<boolean>(false);
  const [recording, setRecording] = useState<boolean>(false);
  const [segments, setSegments] = useState<Segment[]>([]);
  const [count, setCount] = useState<number>(0);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const supabaseRef = useRef<SupabaseClient | null>(null);

  // ---- Init Supabase client (anon) côté navigateur
  useEffect(() => {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!url || !anon) {
      console.error("Supabase env vars manquantes côté client.");
      return;
    }
    supabaseRef.current = createClient(url, anon);
  }, []);

  // ---- Détection feature‐safe
  useEffect(() => {
    let ok = false;
    if (typeof window !== "undefined" && typeof navigator !== "undefined") {
      const mr = (window as any).MediaRecorder;
      const md = (navigator as any).mediaDevices;
      ok = !!(mr && md && typeof md.getUserMedia === "function");
    }
    setSupported(ok);
  }, []);

  // ---- Notifie le parent à chaque changement
  useEffect(() => {
    onChange?.(segments.map((s) => s.storagePath));
  }, [segments, onChange]);

  const startRecording = useCallback(async () => {
    if (!supported) return;
    try {
      const md: any = (navigator as any).mediaDevices;
      const stream: MediaStream = await md.getUserMedia({ audio: true });

      const mr: any = (window as any).MediaRecorder
        ? new (window as any).MediaRecorder(stream, { mimeType: "audio/webm" })
        : null;

      if (!mr) throw new Error("MediaRecorder non disponible.");

      chunksRef.current = [];

      mr.ondataavailable = (e: BlobEvent) => {
        if (e.data && e.data.size > 0) chunksRef.current.push(e.data);
      };

      mr.onstop = async () => {
        const blob = new Blob(chunksRef.current, { type: "audio/webm" });
        await saveSegment(blob);
        // stop tracks
        stream.getTracks().forEach((t) => t.stop());
      };

      mediaRecorderRef.current = mr as MediaRecorder;
      mediaRecorderRef.current.start();
      setRecording(true);
    } catch (e) {
      const msg = (e as any && (e as any).message) ? (e as any).message : String(e);
      alert(`Impossible d'accéder au micro : ${msg}`);
    }
  }, [supported, consultationId, bucket]);

  const stopRecording = useCallback(() => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
      mediaRecorderRef.current.stop();
    }
    setRecording(false);
  }, []);

  const saveSegment = useCallback(
    async (blob: Blob) => {
      const supabase = supabaseRef.current;
      if (!supabase) {
        alert("Supabase non initialisé côté client.");
        return;
      }

      const next = count + 1;
      const relativePath = `${consultationId}/seg-${next}.webm`; // chemin DANS le bucket
      const storagePath = `${bucket}/${relativePath}`;           // affichage friendly

      const { error } = await supabase.storage.from(bucket).upload(relativePath, blob, {
        contentType: "audio/webm",
        upsert: false,
      });
      if (error) {
        alert("Upload audio échoué : " + error.message);
        return;
      }

      // URL signée 30 min pour écoute facultative
      const { data: signed } = await supabase.storage.from(bucket).createSignedUrl(relativePath, 60 * 30);

      setCount(next);
      setSegments((prev) => [
        ...prev,
        { storagePath, signedUrl: signed?.signedUrl, size: blob.size },
      ]);
    },
    [bucket, consultationId, count]
  );

  const removeLast = useCallback(async () => {
    const supabase = supabaseRef.current;
    if (!supabase) return;
    if (segments.length === 0) return;

    const last = segments[segments.length - 1];

    // last.storagePath = "audio/<id>/seg-X.webm" -> retire "audio/"
    const relative =
      last.storagePath.startsWith(`${bucket}/`)
        ? last.storagePath.slice(bucket.length + 1)
        : last.storagePath;

    // 1) on supprime dans Storage (await ici, pas dans setState)
    await supabase.storage.from(bucket).remove([relative]);

    // 2) puis on met à jour le state
    setSegments((prev) => prev.slice(0, -1));
    setCount((n) => Math.max(0, n - 1));
  }, [bucket, segments]);

  return (
    <div>
      {!supported && (
        <p style={{ color: "crimson" }}>
          Enregistrement audio non supporté par ce navigateur.
        </p>
      )}

      <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
        {!recording ? (
          <button type="button" onClick={startRecording} disabled={!supported}>
            🎙️ Démarrer
          </button>
        ) : (
          <button type="button" onClick={stopRecording}>
            ⏹️ Arrêter
          </button>
        )}
        <button type="button" onClick={removeLast} disabled={segments.length === 0}>
          🧹 Supprimer le dernier segment
        </button>
      </div>

      <div style={{ fontSize: 14, color: "#555", marginBottom: 6 }}>
        Segments : <strong>{segments.length}</strong>
      </div>

      {segments.length > 0 && (
        <ul style={{ marginTop: 6 }}>
          {segments.map((s, i) => (
            <li key={s.storagePath + i} style={{ wordBreak: "break-all", marginBottom: 8 }}>
              {s.storagePath}
              {s.signedUrl && (
                <>
                  {" — "}
                  <audio controls src={s.signedUrl} style={{ verticalAlign: "middle" }}>
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

