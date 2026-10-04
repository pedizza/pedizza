"use client";
import { useEffect } from "react";
export function PrintButton({ auto = false }: { auto?: boolean }) {
  useEffect(() => {
    if (auto) {
      const timer = setTimeout(() => window.print(), 500);
      return () => clearTimeout(timer);
    }
  }, [auto]);
  return (
    <button className="btn no-print" onClick={() => window.print()}>
      Imprimir comprovante
    </button>
  );
}
