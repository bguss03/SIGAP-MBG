"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useAnchorWallet, useConnection } from "@solana/wallet-adapter-react";
import { configPda, getProgram, memberPda, toNum } from "@/lib/sigap";

/* eslint-disable @typescript-eslint/no-explicit-any */

export function useProgram() {
  const { connection } = useConnection();
  const wallet = useAnchorWallet();
  const program = useMemo(() => getProgram(connection, wallet), [connection, wallet]);
  return { program, wallet, connection };
}

export type ConfigData = {
  admin: string;
  sopMaxMinutes: number;
  dangerMinX10: number;
  dangerMaxX10: number;
  dangerMaxMinutes: number;
  batchCount: number;
  incidentCount: number;
  recallCount: number;
};

/** Konfigurasi global + data keanggotaan wallet yang terhubung. */
export function useSigap() {
  const { program, wallet, connection } = useProgram();
  const [config, setConfig] = useState<ConfigData | null>(null);
  const [member, setMember] = useState<{ name: string; roles: number; active: boolean } | null>(null);
  const [loading, setLoading] = useState(true);
  const [tick, setTick] = useState(0);

  const refresh = useCallback(() => setTick((t) => t + 1), []);

  useEffect(() => {
    let alive = true;
    (async () => {
      setLoading(true);
      try {
        const c: any = await (program.account as any).config.fetchNullable(configPda());
        if (!alive) return;
        setConfig(
          c
            ? {
                admin: c.admin.toBase58(),
                sopMaxMinutes: c.sopMaxMinutes,
                dangerMinX10: c.dangerMinX10,
                dangerMaxX10: c.dangerMaxX10,
                dangerMaxMinutes: c.dangerMaxMinutes,
                batchCount: toNum(c.batchCount),
                incidentCount: toNum(c.incidentCount),
                recallCount: toNum(c.recallCount),
              }
            : null,
        );
        if (wallet) {
          const m: any = await (program.account as any).member.fetchNullable(memberPda(wallet.publicKey));
          if (alive) setMember(m ? { name: m.name, roles: m.roles, active: m.active } : null);
        } else setMember(null);
      } catch (e) {
        console.error(e);
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [program, wallet, tick]);

  const isAdmin = !!(wallet && config && config.admin === wallet.publicKey.toBase58());
  const hasRole = (r: number) => !!member && member.active && (member.roles & r) !== 0;

  return { program, wallet, connection, config, member, isAdmin, hasRole, loading, refresh };
}

/** Status transaksi sederhana untuk tombol aksi. */
export function useTx() {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "err" | "info"; text: string; sig?: string } | null>(null);
  const run = useCallback(async (label: string, fn: () => Promise<string | void>) => {
    setBusy(true);
    setMsg({ kind: "info", text: `${label}… (setujui di wallet)` });
    try {
      const sig = await fn();
      setMsg({ kind: "ok", text: `${label} berhasil`, sig: sig || undefined });
      return true;
    } catch (e) {
      console.error(e);
      const { errMsg } = await import("@/lib/sigap");
      setMsg({ kind: "err", text: `${label} gagal: ${errMsg(e)}` });
      return false;
    } finally {
      setBusy(false);
    }
  }, []);
  return { busy, msg, setMsg, run };
}
