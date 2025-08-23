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

const MAX_SEGMENT_MS = 5 * 60 * 1000; // 5:00 minutes

export default function RecorderMulti({
  onChange,
  consultationId,
  bucket,
}: RecorderMultiProps) {
  const [supported, setSupported] = useState<boolean>(false);
  const [recording, setRecording] = useState<boolean>(false);
  const [segments, setSegments] = useState<Segment[]>([]);
  const [elapsedMs, setElapsedMs] = useState<number>(0);
  const [uploading, setUploading] = useState<boolean>(false);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const supabaseRef = useRef<SupabaseClient | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  // timers
  const intervalIdRef = useRef<number | null>(null);
  const timeoutIdRef = useRef<number | null>(null);
  const startTsRef = useRef<number | null>(null);

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
      const MR = (window as any).MediaRecorder;
      const md = (navigator as any).mediaDevices;
      ok = !!(MR && md && typeof md.getUserMedia === "function");
    }
    setSupported(ok);
  }, []);

  // ---- Notifie le parent à chaque changement
  useEffect(() => {
    onChange?.(segments.map((s) => s.storagePath));
  }, [segments, onChange]);

  const clearTimers = () => {
    if (intervalIdRef.current !== null) {
      window.clearInterval(intervalIdRef.current);
      intervalIdRef.current = null;
    }
    if (timeoutIdRef.current !== null) {
      window.clearTimeout(timeoutIdRef.current);
      timeoutIdRef.current = null;
    }
  };

  const cleanupStream = () => {
    if (streamRef.current) {
      try {
        streamRef.current.getTracks().forEach((t) => t.stop());
      } catch {}
      streamRef.current = null;
    }
  };

  const formatTime = (ms: number) => {
    const total = Math.floor(ms / 1000);
    const m = String(Math.floor(total / 60)).padStart(2, "0");
    const s = String(total % 60).padStart(2, "0");
    return `${m}:${s}`;
  };

  /** Récupère le prochain index libre dans le dossier Storage (robuste même après refresh) */
  const getNextIndex = useCallback(async (): Promise<number> => {
    const supabase = supabaseRef.current;
    if (!supabase) return 1;

    const { data, error } = await supabase.storage.from(bucket).list(consultationId);
    if (error) {
      console.warn("list() Storage a échoué, fallback segments.length+1", error.message);
      return segments.length + 1;
    }
    let max = 0;
    for (const f of data || []) {
      // f.name ex: "seg-2.webm"
      const m = /^seg-(\d+)\.webm$/.exec(f.name);
      if (m) {
        const n = parseInt(m[1], 10);
        if (n > max) max = n;
      }
    }
    return max + 1;
  }, [bucket, consultationId, segments.length]);

  const startRecording = useCallback(async () => {
    if (!supported || recording || uploading) return;

    try {
      const md: any = (navigator as any).mediaDevices;
      const stream: MediaStream = await md.getUserMedia({ audio: true });
      streamRef.current = stream;

      // Choix de mimeType robuste (webm/opus si possible)
      const MR: any =
        typeof window !== "undefined" ? (window as any).MediaRecorder : null;
      const isSupported = (t: string) =>
        !!(MR && typeof MR.isTypeSupported === "function" && MR.isTypeSupported(t));

      const preferred =
        (isSupported("audio/webm;codecs=opus") && "audio/webm;codecs=opus") ||
        (isSupported("audio/webm") && "audio/webm") ||
        (isSupported("audio/mp4") && "audio/mp4") ||
        "";

      const mr: any = MR
        ? new MR(stream, preferred ? { mimeType: preferred } : undefined)
        : null;

      if (!mr) throw new Error("MediaRecorder non disponible.");

      chunksRef.current = [];
      setElapsedMs(0);

      mr.ondataavailable = (e: any) => {
        if (e?.data && e.data.size > 0) chunksRef.current.push(e.data);
      };

      mr.onstop = async () => {
        clearTimers();
        const blob = new Blob(chunksRef.current, {
          type: mr.mimeType || "audio/webm",
        });
        await saveSegment(blob);
        chunksRef.current = [];
        startTsRef.current = null;
        setElapsedMs(0);
        cleanupStream();
      };

      mediaRecorderRef.current = mr as MediaRecorder;
      mediaRecorderRef.current.start();
      setRecording(true);
      startTsRef.current = performance.now();

      // minuterie visuelle (toutes les 200ms)
      intervalIdRef.current = window.setInterval(() => {
        if (!startTsRef.current) return;
        const now = performance.now();
        const ms = now - startTsRef.current;
        setElapsedMs(ms >= MAX_SEGMENT_MS ? MAX_SEGMENT_MS : ms);
      }, 200) as unknown as number;

      // arrêt auto à 5 min
      timeoutIdRef.current = window.setTimeout(() => {
        if (
          mediaRecorderRef.current &&
          mediaRecorderRef.current.state !== "inactive"
        ) {
          mediaRecorderRef.current.stop();
        }
        setRecording(false);
      }, MAX_SEGMENT_MS) as unknown as number;
    } catch (e) {
      const msg =
        (e as any && (e as any).message) ? (e as any).message : String(e);
      alert(`Impossible d'accéder au micro : ${msg}`);
      cleanupStream();
      clearTimers();
      setRecording(false);
      setElapsedMs(0);
    }
  }, [supported, recording, uploading]);

  const stopRecording = useCallback(() => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
      mediaRecorderRef.current.stop();
    }
    setRecording(false);
    clearTimers();
  }, []);

  const saveSegment = useCallback(
    async (blob: Blob) => {
      const supabase = supabaseRef.current;
      if (!supabase) {
        alert("Supabase non initialisé côté client.");
        return;
      }

      setUploading(true);

      // Détermine l'index libre depuis le Storage pour éviter "already exists"
      let next = await getNextIndex();
      let relativePath = `${consultationId}/seg-${next}.webm`;
      let storagePath = `${bucket}/${relativePath}`;

      // Tentative d'upload (si conflit improbable, on ré-essaie en incrémentant)
      for (let attempt = 0; attempt < 3; attempt++) {
        const { error } = await supabase.storage
          .from(bucket)
          .upload(relativePath, blob, {
            contentType: "audio/webm",
            upsert: false, // important: on veut un vrai nouvel objet
          });

        if (!error) {
          // URL signée 30 min pour écoute facultative
          const { data: signed } = await supabase.storage
            .from(bucket)
            .createSignedUrl(relativePath, 60 * 30);

          setSegments((prev) => [
            ...prev,
            { storagePath, signedUrl: signed?.signedUrl, size: blob.size },
          ]);
          setUploading(false);
          return;
        }

        // Si l'objet existe déjà, on incrémente et on retente
        if (String(error.message).toLowerCase().includes("already exists")) {
          next += 1;
          relativePath = `${consultationId}/seg-${next}.webm`;
          storagePath = `${bucket}/${relativePath}`;
          continue;
        }

        // autre erreur
        alert("Upload audio échoué : " + error.message);
        setUploading(false);
        return;
      }

      // Si on arrive ici après 3 tentatives, on abandonne proprement
      alert("Upload audio échoué après plusieurs tentatives (conflit de nom).");
      setUploading(false);
    },
    [bucket, consultationId, getNextIndex]
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
  }, [bucket, segments]);

  // cleanup au démontage
  useEffect(() => {
    return () => {
      try {
        if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
          mediaRecorderRef.current.stop();
        }
      } catch {}
      clearTimers();
      cleanupStream();
    };
  }, []);

  const progress = Math.min(100, Math.round((elapsedMs / MAX_SEGMENT_MS) * 100));

  return (
    <div>
      {!supported && (
        <p style={{ color: "crimson" }}>
          Enregistrement audio non supporté par ce navigateur.
        </p>
      )}

      <div style={{ display: "flex", gap: 8, marginBottom: 10, alignItems: "center" }}>
        {!recording ? (
          <button type="button" onClick={startRecording} disabled={!supported || uploading}>
            🎙️ Démarrer
          </button>
        ) : (
          <>
            <button type="button" onClick={stopRecording}>
              ⏹️ Arrêter
            </button>
            <span style={{ fontFamily: "monospace", fontSize: 16 }}>
              {formatTime(elapsedMs)} / {formatTime(MAX_SEGMENT_MS)}
            </span>
          </>
        )}
        <button type="button" onClick={removeLast} disabled={segments.length === 0 || recording || uploading}>
          🧹 Supprimer le dernier segment
        </button>
        {uploading && <span style={{ fontSize: 12, color: "#666" }}>Upload en cours…</span>}
      </div>

      {/* barre de progression */}
      <div
        style={{
          height: 8,
          width: "100%",
          background: "#eee",
          borderRadius: 999,
          overflow: "hidden",
          marginBottom: 6,
        }}
      >
        <div
          style={{
            height: "100%",
            width: `${progress}%`,
            background: "#111",
            transition: "width 200ms linear",
          }}
        />
      </div>

      <div style={{ fontSize: 12, color: "#555", marginBottom: 6 }}>
        L’enregistrement s’arrête automatiquement à 5 minutes et crée un segment.
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

