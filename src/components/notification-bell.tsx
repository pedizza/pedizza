"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Bell } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useRealtime } from "./realtime";
export function NotificationBell({ tenantId }: { tenantId: string }) {
  const pathname = usePathname();
  const [unread, setUnread] = useState(0);
  const knownNotifications = useRef<Set<string> | null>(null),
    audio = useRef<HTMLAudioElement | null>(null),
    loading = useRef(false);
  useEffect(() => {
    const player = new Audio("/sounds/toque-pedido-novo.mp3");
    player.preload = "auto";
    audio.current = player;
    function unlock() {
      player.muted = true;
      void player
        .play()
        .then(() => {
          player.pause();
          player.currentTime = 0;
          player.muted = false;
          window.removeEventListener("pointerdown", unlock);
          window.removeEventListener("keydown", unlock);
        })
        .catch(() => {
          player.muted = false;
        });
    }
    window.addEventListener("pointerdown", unlock);
    window.addEventListener("keydown", unlock);
    return () => {
      window.removeEventListener("pointerdown", unlock);
      window.removeEventListener("keydown", unlock);
      player.pause();
      audio.current = null;
    };
  }, []);
  const load = useCallback(() => {
    if (loading.current) return;
    loading.current = true;
    void fetch("/api/notifications")
      .then(async (r) => {
        if (!r.ok) return;
        const b = await r.json();
        setUnread(b.unread);
        const notices = (b.data || []) as { id: string; type: string }[];
        const previous = knownNotifications.current;
        const hasNewOrder =
          previous !== null &&
          notices.some(
            (notice) => notice.type === "order.new" && !previous.has(notice.id),
          );
        knownNotifications.current = new Set(
          notices.map((notice) => notice.id),
        );
        if (
          hasNewOrder &&
          !pathname.startsWith("/app/pedidos") &&
          b.preferences?.sound_enabled &&
          b.preferences?.orders_enabled &&
          audio.current
        ) {
          audio.current.currentTime = 0;
          void audio.current.play().catch(() => {});
        }
      })
      .catch(() => {})
      .finally(() => {
        loading.current = false;
      });
  }, [pathname]);
  useEffect(load, [load]);
  useRealtime(tenantId, "notifications", load, undefined, 1500);
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
