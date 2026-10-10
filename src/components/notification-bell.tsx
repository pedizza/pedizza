"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Bell } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useRealtime } from "./realtime";
export function NotificationBell({ tenantId }: { tenantId: string }) {
  const pathname = usePathname();
  const [unread, setUnread] = useState(0);
  const [pendingCount, setPendingCount] = useState(0);
  const audio = useRef<HTMLAudioElement | null>(null),
    loading = useRef(false),
    preferences = useRef({ sound: false, orders: true }),
    pendingOrders = useRef(new Set<string>()),
    alarmTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    const player = new Audio("/sounds/pedido-novo.mp3");
    player.preload = "auto";
    player.loop = false;
    audio.current = player;
    player.load();
    function shouldRing() {
      return (
        pendingOrders.current.size > 0 &&
        preferences.current.sound &&
        preferences.current.orders
      );
    }
    function clearAlarmTimer() {
      if (alarmTimer.current) clearTimeout(alarmTimer.current);
      alarmTimer.current = null;
    }
    function playAfterPause() {
      if (!shouldRing()) return;
      clearAlarmTimer();
      alarmTimer.current = setTimeout(() => {
        alarmTimer.current = null;
        if (!shouldRing()) return;
        player.currentTime = 0;
        void player.play().catch(() => {});
      }, 2000);
    }
    player.addEventListener("ended", playAfterPause);
    function unlock() {
      const ring = shouldRing();
      if (ring) clearAlarmTimer();
      player.muted = !ring;
      void player
        .play()
        .then(() => {
          player.muted = false;
          if (!ring) {
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
      player.removeEventListener("ended", playAfterPause);
      clearAlarmTimer();
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
      player.loop = false;
      if (player.paused && !alarmTimer.current) {
        player.currentTime = 0;
        void player.play().catch(() => {});
      }
    } else {
      if (alarmTimer.current) clearTimeout(alarmTimer.current);
      alarmTimer.current = null;
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
        setPendingCount(pendingOrders.current.size);
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
        setPendingCount(pendingOrders.current.size);
        syncOrderAlarm();
      } catch {}
    });
    return () => source.close();
  }, [tenantId, load]);

  const onOrdersPage =
    pathname.startsWith("/app/pedidos") ||
    pathname.startsWith("/gestor-pedidos");
  return (
    <>
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
      {pendingCount > 0 && !onOrdersPage && (
        <div
          className="new-order-alert"
          role="alertdialog"
          aria-live="assertive"
          aria-label="Novos pedidos aguardando atendimento"
        >
          <span className="new-order-alert-icon">🍕</span>
          <div>
            <strong>
              {pendingCount === 1
                ? "Novo pedido chegou!"
                : `${pendingCount} novos pedidos chegaram!`}
            </strong>
            <p>
              {pendingCount === 1
                ? "Um pedido está aguardando atendimento."
                : "Há pedidos aguardando atendimento."}
            </p>
          </div>
          <Link className="btn" href="/app/pedidos">
            Ir para os pedidos
          </Link>
        </div>
      )}
    </>
  );
}
