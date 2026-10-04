"use client";
import { useEffect, useRef, useState } from "react";
import { Mic, Square } from "lucide-react";
export function AudioRecorder({
  disabled,
  onRecorded,
}: {
  disabled: boolean;
  onRecorded: (file: File) => Promise<void>;
}) {
  const [recording, setRecording] = useState(false),
    [error, setError] = useState("");
  const recorder = useRef<MediaRecorder | null>(null),
    stream = useRef<MediaStream | null>(null),
    timer = useRef<ReturnType<typeof setTimeout> | null>(null),
    mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      if (timer.current) clearTimeout(timer.current);
      if (recorder.current?.state === "recording") recorder.current.stop();
      stream.current?.getTracks().forEach((t) => t.stop());
    };
  }, []);
  async function start() {
    setError("");
    try {
      if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder)
        throw Error(
          "Gravação indisponível neste navegador. Envie um arquivo de áudio.",
        );
      const media = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (!mounted.current) {
        media.getTracks().forEach((t) => t.stop());
        return;
      }
      stream.current = media;
      const mime = ["audio/webm;codecs=opus", "audio/mp4"].find((t) =>
        MediaRecorder.isTypeSupported(t),
      );
      if (!mime) throw Error("Formato de gravação não suportado.");
      const r = new MediaRecorder(media, { mimeType: mime });
      recorder.current = r;
      const chunks: BlobPart[] = [];
      let bytes = 0;
      r.ondataavailable = (e) => {
        if (e.data.size) {
          bytes += e.data.size;
          chunks.push(e.data);
          if (bytes > 2800000 && r.state === "recording") r.stop();
        }
      };
      r.onstop = () => {
        if (timer.current) clearTimeout(timer.current);
        media.getTracks().forEach((t) => t.stop());
        if (!mounted.current) return;
        setRecording(false);
        if (bytes > 3 * 1024 * 1024) {
          setError("Áudio acima de 3 MB. Grave uma mensagem mais curta.");
          return;
        }
        if (bytes)
          void onRecorded(
            new File(
              chunks,
              mime.includes("webm") ? "gravacao.webm" : "gravacao.m4a",
              { type: mime.split(";")[0] },
            ),
          );
      };
      r.start(500);
      setRecording(true);
      timer.current = setTimeout(() => {
        if (r.state === "recording") r.stop();
      }, 60000);
    } catch (e) {
      stream.current?.getTracks().forEach((t) => t.stop());
      setError(
        e instanceof Error
          ? e.message
          : "Permita o acesso ao microfone para gravar.",
      );
    }
  }
  return (
    <span className="stack">
      <button
        className="btn secondary small"
        type="button"
        disabled={disabled && !recording}
        onClick={() => (recording ? recorder.current?.stop() : void start())}
        aria-label={
          recording ? "Parar e enviar áudio" : "Gravar áudio de até 60 segundos"
        }
      >
        {recording ? <Square size={17} /> : <Mic size={17} />}
      </button>
      {recording && <small>Gravando · até 60s</small>}
      {error && <small role="alert">{error}</small>}
    </span>
  );
}
