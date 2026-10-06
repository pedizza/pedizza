"use client";
import Link from "next/link";
import { Bell } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useRealtime } from "./realtime";
export function NotificationBell({ tenantId }: { tenantId: string }) {
  const [unread, setUnread] = useState(0);
  const audio = useRef<HTMLAudioElement | null>(null),
    loading = useRef(false),
    preferences = useRef({ sound: false, orders: true }),
    pendingOrders = useRef(new Set<string>());
  useEffect(() => {
    const player = new Audio("/sounds/toque-pedido-novo.mp3");
    player.preload = "auto";
    player.loop = true;
    audio.current = player;
    player.load();
    function unlock() {
      const shouldRing =
        pendingOrders.current.size > 0 &&
        preferences.current.sound &&
        preferences.current.orders;
      player.muted = !shouldRing;
      void player
        .play()
        .then(() => {
          player.muted = false;
          if (!shouldRing) {
            player.pause();
            player.currentTime = 0;
          }
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
  function syncOrderAlarm() {
    const player = audio.current;
    if (!player) return;
    const shouldRing =
      pendingOrders.current.size > 0 &&
      preferences.current.sound &&
      preferences.current.orders;
    if (shouldRing) {
      player.loop = true;
      if (player.paused) void player.play().catch(() => {});
    } else {
      player.pause();
      player.currentTime = 0;
    }
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
        syncOrderAlarm();
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
        if (detail.order?.order_status === "new")
          pendingOrders.current.add(detail.orderId);
        else pendingOrders.current.delete(detail.orderId);
        window.dispatchEvent(
          new CustomEvent("pedizza:order-change", { detail }),
        );
        requestAnimationFrame(() => syncOrderAlarm());
        void load();
      } catch {}
    });
    source.addEventListener("pending", (message) => {
      try {
        const detail = JSON.parse((message as MessageEvent<string>).data) as {
          ids?: string[];
        };
        pendingOrders.current = new Set(detail.ids || []);
        syncOrderAlarm();
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
