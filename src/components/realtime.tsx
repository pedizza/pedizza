"use client";
import { useEffect, useRef } from "react";
import { supabaseBrowser } from "@/lib/supabase/client";
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
    if (!process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) return;
    const client = supabaseBrowser();
    let timer: ReturnType<typeof setTimeout>;
    const channel = client
      .channel(`${table}:${tenantId}:${filter || ""}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table,
          filter: filter || `tenant_id=eq.${tenantId}`,
        },
        () => {
          clearTimeout(timer);
          timer = setTimeout(() => callback.current(), 250);
        },
      )
      .subscribe((status) => {
        if (status === "SUBSCRIBED") callback.current();
      });
    return () => {
      clearTimeout(timer);
      void client.removeChannel(channel);
    };
  }, [tenantId, table, filter]);
}
