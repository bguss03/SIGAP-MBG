"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { SystemProgram } from "@solana/web3.js";
import { Card, FlagChips, RoleGate, StatusBadge, TxMessage, enumIs } from "@/components/ui";
import { useSigap, useTx } from "@/lib/hooks";
import { configPda, fmtDuration, fmtTime, memberPda, recallPda, ROLES, short, toHex, toNum } from "@/lib/sigap";

/* eslint-disable @typescript-eslint/no-explicit-any */

export default function DinkesPage() {
  return (
    <div className="stack">
      <div className="page-head">
        <h1>Dinkes / Kemenkes</h1>
        <p>Satu catatan insiden bersama untuk semua instansi. Verifikasi laporan dari sekolah/puskesmas — jika terverifikasi, <b>RecallContract</b> otomatis membekukan batch yang sama di semua sekolah penerima.</p>
      </div>
      <RoleGate role={ROLES.DINKES} label="Dinkes">
        <DinkesInner />
      </RoleGate>
    </div>
  );
}

function DinkesInner() {
  const { program, wallet, refresh } = useSigap();
  const tx = useTx();
  const [rows, setRows] = useState<any[] | null>(null);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [tick, setTick] = useState(0);

  useEffect(() => {
    (async () => {
      const incs = await (program.account as any).incident.all();
      const bs = await (program.account as any).batch.fetchMultiple(incs.map((i: any) => i.account.batch));
      const r = incs.map((i: any, k: number) => ({ key: i.publicKey, inc: i.account, batch: bs[k] }));
      r.sort((a: any, b: any) => {
        const pa = enumIs(a.inc.status, "dilaporkan") ? 0 : 1, pb = enumIs(b.inc.status, "dilaporkan") ? 0 : 1;
        return pa - pb || toNum(b.inc.reportedAt) - toNum(a.inc.reportedAt);
      });
      setRows(r);
    })().catch((e) => { console.error(e); setRows([]); });
  }, [program, tick]);

  const verify = (row: any, confirmed: boolean) =>
    tx.run(confirmed ? "Verifikasi insiden & recall" : "Tolak laporan", async () => {
      const k = row.key.toBase58();
      const sig = await program.methods
        .verifyIncident(confirmed, notes[k] || (confirmed ? "Terverifikasi Dinkes" : "Tidak terbukti"))
        .accountsPartial({
          config: configPda(), member: memberPda(wallet!.publicKey), batch: row.inc.batch, incident: row.key,
          recall: recallPda(row.inc.batch), authority: wallet!.publicKey, systemProgram: SystemProgram.programId,
        })
        .rpc();
      setTick((t) => t + 1);
      refresh();
      return sig;
    });

  return (
    <Card title="Laporan insiden">
      <TxMessage msg={tx.msg} />
      {rows === null ? <p className="muted">Memuat…</p> : rows.length === 0 ? <p className="muted">Belum ada laporan insiden.</p> : (
        <div className="stack" style={{ marginTop: 12 }}>
          {rows.map((row) => {
            const { inc, batch } = row;
            const k = row.key.toBase58();
            const pending = enumIs(inc.status, "dilaporkan");
            return (
              <div key={k} className="card" style={{ borderColor: pending ? "#f0d49b" : undefined }}>
                <div className="row">
                  <b>Batch <Link className="mono" href={`/cek/${encodeURIComponent(batch?.batchId ?? "")}`}>{batch?.batchId}</Link></b>
                  <span className={`chip ${pending ? "chip-warn" : enumIs(inc.status, "terverifikasi") ? "chip-danger" : ""}`}>{Object.keys(inc.status)[0].toUpperCase()}</span>
                  {batch && <StatusBadge status={batch.status} />}
                  <span className="spacer" />
                  <span className="small muted">{fmtTime(toNum(inc.reportedAt))}</span>
                </div>
                <p style={{ margin: "8px 0" }}>{inc.description}</p>
                <div className="small muted">
                  {inc.affectedCount} orang terdampak · pelapor {short(inc.reporter)} · hash bukti <code>{toHex(inc.evidenceHash).slice(0, 16)}…</code>
                </div>
                {batch && (
                  <div className="small" style={{ marginTop: 6 }}>
                    Data batch: dimasak {fmtTime(toNum(batch.cookedAt))} · {batch.deliveryCount} sekolah penerima · zona bahaya {fmtDuration(batch.dangerSeconds)} · <FlagChips flags={batch.flags} />
                  </div>
                )}
                {pending ? (
                  <div className="row" style={{ marginTop: 10 }}>
                    <input placeholder="Catatan verifikasi (hasil investigasi lapangan)" maxLength={200} value={notes[k] ?? ""} onChange={(e) => setNotes({ ...notes, [k]: e.target.value })} style={{ flex: 1, minWidth: 240 }} />
                    <button className="btn btn-danger" disabled={tx.busy} onClick={() => verify(row, true)}>Verifikasi → Recall batch</button>
                    <button className="btn btn-ghost" disabled={tx.busy} onClick={() => verify(row, false)}>Tolak</button>
                  </div>
                ) : (
                  <div className="small muted" style={{ marginTop: 6 }}>Diverifikasi {short(inc.verifier)} pada {fmtTime(toNum(inc.verifiedAt))}: “{inc.note}”</div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </Card>
  );
}
