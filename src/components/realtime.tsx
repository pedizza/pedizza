"use client";
import { useEffect, useRef } from "react";
// JWT stays in HttpOnly cookies. Refresh through tenant-authorized APIs.
export function useRealtime(
  tenantId: string,
  table: string,
  onChange: () => void,
  filter?: string,
) {
  const callback = useRef(onChange);
  useEffect(() => {
    callback.current = onChange;
  }, [onChange]);
  useEffect(() => {
    const refresh = () => {
      if (document.visibilityState === "visible") callback.current();
    };
    const timer = setInterval(refresh, 5000);
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      clearInterval(timer);
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [tenantId, table, filter]);
}
