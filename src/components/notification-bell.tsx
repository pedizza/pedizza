"use client";
import Link from "next/link";
import { Bell } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useRealtime } from "./realtime";
export function NotificationBell({ tenantId }: { tenantId: string }) {
  const [unread, setUnread] = useState(0);
  const knownNotifications = useRef<Set<string> | null>(null),
    audio = useRef<HTMLAudioElement | null>(null),
    loading = useRef(false),
    preferences = useRef({ sound: false, orders: true }),
    lastRealtimeOrderAt = useRef(0);
  useEffect(() => {
    const player = new Audio("/sounds/toque-pedido-novo.mp3");
    player.preload = "auto";
    audio.current = player;
    player.load();
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
  function playOrderSound() {
    if (
      !preferences.current.sound ||
      !preferences.current.orders ||
      !audio.current
    )
      return;
    audio.current.currentTime = 0;
    void audio.current.play().catch(() => {});
  }
  const load = useCallback(() => {
    if (loading.current) return;
    loading.current = true;
    void fetch("/api/notifications")
      .then(async (r) => {
        if (!r.ok) return;
        const b = await r.json();
        setUnread(b.unread);
        preferences.current = {
          sound: !!b.preferences?.sound_enabled,
          orders: b.preferences?.orders_enabled !== false,
        };
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
        if (hasNewOrder && Date.now() - lastRealtimeOrderAt.current > 5000)
          playOrderSound();
      })
      .catch(() => {})
      .finally(() => {
        loading.current = false;
      });
  }, []);
  useEffect(load, [load]);
  useRealtime(tenantId, "notifications", load, undefined, 15000);
  useEffect(() => {
    const source = new EventSource("/api/orders/events");
    source.addEventListener("open", () => {
      window.dispatchEvent(
        new CustomEvent("pedizza:realtime-state", {
          detail: { connected: true },
        }),
      );
    });
    source.addEventListener("error", () => {
      window.dispatchEvent(
        new CustomEvent("pedizza:realtime-state", {
          detail: { connected: false },
        }),
      );
    });
    source.addEventListener("order", (message) => {
      try {
        const detail = JSON.parse((message as MessageEvent<string>).data);
        window.dispatchEvent(
          new CustomEvent("pedizza:order-change", { detail }),
        );
        if (detail.kind === "insert") {
          lastRealtimeOrderAt.current = Date.now();
          requestAnimationFrame(() => playOrderSound());
        }
        void load();
      } catch {}
    });
    return () => source.close();
  }, [tenantId, load]);

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
