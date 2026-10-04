"use client";
import Link from "next/link";
import { Bell } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useRealtime } from "./realtime";
export function NotificationBell({ tenantId }: { tenantId: string }) {
  const [unread, setUnread] = useState(0);
  const previous = useRef<number | null>(null),
    audio = useRef<AudioContext | null>(null);
  useEffect(() => {
    function enable() {
      audio.current ??= new AudioContext();
      void audio.current.resume().catch(() => {});
    }
    window.addEventListener("pointerdown", enable, { once: true });
    return () => {
      window.removeEventListener("pointerdown", enable);
      void audio.current?.close();
      audio.current = null;
    };
  }, []);
  const load = useCallback(() => {
    void fetch("/api/notifications")
      .then(async (r) => {
        if (!r.ok) return;
        const b = await r.json();
        setUnread(b.unread);
        if (
          previous.current !== null &&
          b.unread > previous.current &&
          b.preferences?.sound_enabled &&
          audio.current?.state === "running"
        ) {
          const ctx = audio.current,
            o = ctx.createOscillator(),
            g = ctx.createGain();
          o.connect(g);
          g.connect(ctx.destination);
          o.frequency.value = 740;
          g.gain.setValueAtTime(0.07, ctx.currentTime);
          g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.25);
          o.start();
          o.stop(ctx.currentTime + 0.25);
        }
        previous.current = b.unread;
      })
      .catch(() => {});
  }, []);
  useEffect(load, [load]);
  useRealtime(tenantId, "notifications", load);
  return (
    <Link
      href="/app/notificacoes"
      className="icon-button"
      aria-label={`Notificações: ${unread} não lidas`}
      style={{ position: "relative" }}
    >
      <Bell size={18} />
      {unread > 0 && (
        <span
          style={{
            position: "absolute",
            top: -5,
            right: -6,
            fontSize: 10,
            background: "#dc3025",
            color: "white",
            padding: "1px 4px",
            borderRadius: 10,
          }}
        >
          {unread > 99 ? "99+" : unread}
        </span>
      )}
    </Link>
  );
}
