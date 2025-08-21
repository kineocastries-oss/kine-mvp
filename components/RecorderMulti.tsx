"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";

type RecorderMultiProps = {
  onChange?: (paths: string[]) => void;
  consultationId: string;
  bucket: string;
};

export default function RecorderMulti({
  onChange,
  consultationId,
  bucket,
}: RecorderMultiProps) {
  const [recording, setRecording] = useState(false);
  const [segments, setSegments] = useState<string[]>([]);
  const [supported, setSupported] = useState(false);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);

  // Vérifie le support navigateur
  useEffect(() => {
    if (typeof window !== "undefined" && navigator?.mediaDevices?.getUserMedia) {
      setSupported(true);
    }
  }, []);

  // Sauvegarde un segment dans Supabase (ou local pour test)
  const saveSegment = useCallback(
    async (blob: Blob) => {
      const filename = `audio-${Date.now()}.webm`;

      // Pour l’instant on fait un URL local
      const url = URL.createObjectURL(blob);
      setSegments((prev) => {
        const updated = [...prev, url];
        onChange?.(updated);
        return updated;
      });

      // 🚨 si tu veux l’upload supabase, c’est ici
      // const { error } = await supabase.storage.from(bucket).upload(
      //   `${consultationId}/${filename}`, blob,
      //   { contentType: "audio/webm" }
      // );
      // if (error) console.error("Upload error:", error);
    },
    [bucket, consultationId, onChange]
  );

  // Démarre l’enregistrement
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
        stream.getTracks().forEach((t) => t.stop());
      };

      mediaRecorderRef.current = mr;
      mr.start();
      setRecording(true);
    } catch (e) {
      const msg = (e as any)?.message ?? String(e);
      alert(`Impossible d'accéder au micro : ${msg}`);
    }
  }, [supported, saveSegment]);

  // Stoppe l’enregistrement
  const stopRecording = useCallback(() => {
    mediaRecorderRef.current?.stop();
    setRecording(false);
  }, []);

  return (
    <div className="flex flex-col gap-2">
      {!supported && (
        <p className="text-red-500 text-sm">
          Enregistrement audio non supporté sur ce navigateur.
        </p>
      )}

      <div className="flex gap-2">
        {!recording ? (
          <button
            type="button"
            onClick={startRecording}
            disabled={!supported}
            className="bg-green-600 text-white px-3 py-1 rounded"
          >
            ▶️ Démarrer
          </button>
        ) : (
          <button
            type="button"
            onClick={stopRecording}
            className="bg-red-600 text-white px-3 py-1 rounded"
          >
            ⏹️ Arrêter
          </button>
        )}
      </div>

      <div className="mt-2">
        {segments.map((url, i) => (
          <audio key={i} src={url} controls className="my-1 w-full" />
        ))}
      </div>
    </div>
  );
}
