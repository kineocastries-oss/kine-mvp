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
  const [count, setCount] = useState<number>(0);
  const [elapsedMs, setElapsedMs] = useState<number>(0);

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

  const startRecording = useCallback(async () => {
    if (!supported || recording) return;

    try {
      const md: any = (navigator as any).mediaDevices;
      const stream: MediaStream = await md.getUserMedia({ audio: true });
      streamRef.current = stream;

      // Choix de mimeType robuste (webm/opus si possible)
      const preferred =
        (window as any).MediaRecorder &&
        (win

