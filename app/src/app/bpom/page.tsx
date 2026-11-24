"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Card, RoleGate, StatusBadge, TxMessage, enumIs } from "@/components/ui";
import { useSigap, useTx } from "@/lib/hooks";
import { fmtDuration, fmtTemp, fmtTime, isZeroHash, memberPda, ROLES, sha256File, toHex, toNum } from "@/lib/sigap";

/* eslint-disable @typescript-eslint/no-explicit-any */

export default function BpomPage() {
  return (
    <div className="stack">
      <div className="page-head">
        <h1>BPOM · Uji lab sampel retain</h1>
        <p>Daftar batch yang dibekukan (recall). Uji sampel retain dan unggah <b>hash</b> dokumen hasil lab ke blockchain — hasil “terkontaminasi” menetapkan batch sebagai DITARIK, hasil “aman” membebaskan batch.</p>
      </div>
      <RoleGate role={ROLES.BPOM} label="BPOM">
        <BpomInner />
      </RoleGate>
    </div>
  );
}

function BpomInner() {
  const { program, wallet } = useSigap();
  const tx = useTx();
  const [rows, setRows] = useState<any[] | null>(null);
  const [files, setFiles] = useState<Record<string, File | null>>({});
  const [tick, setTick] = useState(0);

  useEffect(() => {
    (async () => {
      const rs = await (program.account as any).recall.all();
      const bs = await (program.account as any).batch.fetchMultiple(rs.map((r: any) => r.account.batch));
      const out = rs.map((r: any, i: number) => ({ key: r.publicKey, recall: r.account, batch: bs[i] }));
      out.sort((a: any, b: any) => toNum(b.recall.frozenAt) - toNum(a.recall.frozenAt));
      setRows(out);
    })().catch((e) => { console.error(e); setRows([]); });
  }, [program, tick]);

  const submit = (row: any, contaminated: boolean) =>
    tx.run("Unggah hasil lab", async () => {
      const k = row.key.toBase58();
      const f = files[k];
      if (!f) throw new Error("Pilih file dokumen hasil lab terlebih dahulu");
      const hash = await sha256File(f);
      const sig = await program.methods
        .submitLabResult(Array.from(hash), contaminated)
        .accountsPartial({ member: memberPda(wallet!.publicKey), batch: row.recall.batch, recall: row.key, authority: wallet!.publicKey })
        .rpc();
      setTick((t) => t + 1);
      return sig;
    });

  return (
    <Card title="Batch dalam recall">
      <TxMessage msg={tx.msg} />
      {rows === null ? <p className="muted">Memuat…</p> : rows.length === 0 ? <p className="muted">Tidak ada batch yang dibekukan.</p> : (
        <div className="table-wrap">
          <table>
            <thead><tr><th>Batch</th><th>Sampel retain</th><th>Data rantai dingin</th><th>Status</th><th>Hasil lab</th></tr></thead>
            <tbody>
              {rows.map((row) => {
                const { recall: r, batch: b } = row;
                const k = row.key.toBase58();
                const waiting = enumIs(r.labResult, "menunggu");
                return (
                  <tr key={k}>
                    <td>
                      <Link className="mono" href={`/cek/${encodeURIComponent(r.batchId)}`}><b>{r.batchId}</b></Link>
                      <div className="small muted">Dibekukan {fmtTime(toNum(r.frozenAt))}<br />{r.affectedDeliveries} sekolah terdampak</div>
                    </td>
                    <td className="mono">{b?.retainSampleId || "—"}</td>
                    <td className="small">
                      {b ? <>{b.tempCount} pembacaan · {fmtTemp(b.minTempX10)}–{fmtTemp(b.maxTempX10)}<br />zona bahaya {fmtDuration(b.dangerSeconds)}</> : "—"}
                    </td>
                    <td>{b && <StatusBadge status={b.status} />}</td>
                    <td style={{ minWidth: 260 }}>
                      {waiting ? (
                        <>
                          <input type="file" onChange={(e) => setFiles({ ...files, [k]: e.target.files?.[0] ?? null })} />
                          <div className="row" style={{ marginTop: 6 }}>
                            <button className="btn btn-sm btn-danger" disabled={tx.busy} onClick={() => submit(row, true)}>Terkontaminasi</button>
                            <button className="btn btn-sm" disabled={tx.busy} onClick={() => submit(row, false)}>Aman</button>
                          </div>
                        </>
                      ) : (
                        <div className="small">
                          <span className={`chip ${enumIs(r.labResult, "aman") ? "" : "chip-danger"}`}>{Object.keys(r.labResult)[0].toUpperCase()}</span>
                          <div className="muted">{fmtTime(toNum(r.labAt))}</div>
                          {!isZeroHash(r.labHash) && <code>{toHex(r.labHash).slice(0, 20)}…</code>}
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}
