"use client";

import { useCallback, useEffect, useState } from "react";
import QrScanner from "@/components/QrScanner";
import { SystemProgram } from "@solana/web3.js";
import { Card, FlagChips, RoleGate, StatusBadge, TxMessage, enumIs } from "@/components/ui";
import { useSigap, useTx } from "@/lib/hooks";
import {
  batchPda, BN, configPda, deliveryPda, fmtDuration, fmtTime, fromDatetimeLocal, incidentPda, memberPda, nowSec,
  parseBatchQr, ROLES, sha256File, sha256Text, toDatetimeLocal, toNum,
} from "@/lib/sigap";

/* eslint-disable @typescript-eslint/no-explicit-any */

export default function SekolahPage() {
  return (
    <div className="stack">
      <div className="page-head">
        <h1>Sekolah penerima</h1>
        <p>Scan QR pada boks/ompreng saat makanan tiba, catat jam konsumsi siswa, dan laporkan gejala bila ada. Semua tercatat di Solana dan langsung terlihat oleh Dinkes, BPOM, dan BGN.</p>
      </div>
      <RoleGate role={ROLES.SEKOLAH} label="Sekolah">
        <SekolahInner />
      </RoleGate>
    </div>
  );
}

function SekolahInner() {
  const { program, wallet, config } = useSigap();
  const [input, setInput] = useState("");
  const [batchId, setBatchId] = useState<string | null>(null);
  const [mine, setMine] = useState<any[]>([]);

  useEffect(() => {
    if (!wallet) return;
    (async () => {
      const ds = await (program.account as any).delivery.all([{ memcmp: { offset: 8 + 32, bytes: wallet.publicKey.toBase58() } }]);
      const bs = await (program.account as any).batch.fetchMultiple(ds.map((d: any) => d.account.batch));
      setMine(ds.map((d: any, i: number) => ({ d: d.account, b: bs[i] })).filter((x: any) => x.b).sort((a: any, b: any) => toNum(b.d.dispatchedAt) - toNum(a.d.dispatchedAt)));
    })().catch(console.error);
  }, [program, wallet, batchId]);

  const onScan = useCallback((t: string) => {
    const id = parseBatchQr(t);
    setInput(id);
    setBatchId(id);
  }, []);

  return (
    <>
      <div className="grid grid-2">
        <Card title="5 · Terima makanan">
          <form className="row" onSubmit={(e) => { e.preventDefault(); if (input.trim()) setBatchId(parseBatchQr(input)); }}>
            <input placeholder="ID batch atau URL QR" value={input} onChange={(e) => setInput(e.target.value)} style={{ flex: 1 }} />
            <button className="btn">Buka</button>
          </form>
          <div style={{ marginTop: 10 }}>
            <QrScanner onResult={onScan} />
          </div>
        </Card>
        <Card title={`Kiriman untuk sekolah ini (${mine.length})`}>
          {mine.length === 0 ? <p className="muted">Belum ada kiriman tercatat.</p> : (
            <table>
              <tbody>
                {mine.map(({ d, b }) => (
                  <tr key={b.batchId} style={{ cursor: "pointer" }} onClick={() => { setInput(b.batchId); setBatchId(b.batchId); }}>
                    <td><b className="mono">{b.batchId}</b><div className="small muted">{b.menu}</div></td>
                    <td className="small">{d.consumedAt.toNumber() ? "Dikonsumsi" : d.receivedAt.toNumber() ? "Diterima" : "Dalam perjalanan"}</td>
                    <td><StatusBadge status={b.status} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      </div>
      {batchId && config && <SchoolBatch key={batchId} batchId={batchId} sop={config.sopMaxMinutes} />}
    </>
  );
}

function SchoolBatch({ batchId, sop }: { batchId: string; sop: number }) {
  const { program, wallet } = useSigap();
  const tx = useTx();
  const [batch, setBatch] = useState<any>(undefined);
  const [delivery, setDelivery] = useState<any>(undefined);
  const [consumed, setConsumed] = useState(toDatetimeLocal(nowSec()));
  const [desc, setDesc] = useState("");
  const [affected, setAffected] = useState(1);
  const [file, setFile] = useState<File | null>(null);
  const [tick, setTick] = useState(0);
  const batchKey = batchPda(batchId);

  useEffect(() => {
    (async () => {
      setBatch(await (program.account as any).batch.fetchNullable(batchKey));
      setDelivery(await (program.account as any).delivery.fetchNullable(deliveryPda(batchKey, wallet!.publicKey)));
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [program, batchId, tick]);

  if (batch === undefined) return <div className="empty">Memuat batch…</div>;
  if (batch === null) return <div className="empty">Batch <code>{batchId}</code> tidak ditemukan di blockchain.</div>;

  const frozen = enumIs(batch.status, "dibekukan") || enumIs(batch.status, "ditarik");
  const elapsed = fromDatetimeLocal(consumed) - toNum(batch.cookedAt);
  const accounts = { config: configPda(), member: memberPda(wallet!.publicKey), batch: batchKey, delivery: deliveryPda(batchKey, wallet!.publicKey), authority: wallet!.publicKey };

  const receive = () => tx.run("Konfirmasi penerimaan", async () => {
    const sig = await program.methods.confirmReceipt().accountsPartial(accounts).rpc();
    setTick((t) => t + 1);
    return sig;
  });
  const consume = () => tx.run("Catat jam konsumsi", async () => {
    const sig = await program.methods.recordConsumption(new BN(fromDatetimeLocal(consumed))).accountsPartial(accounts).rpc();
    setTick((t) => t + 1);
    return sig;
  });
  const report = () => tx.run("Laporkan insiden", async () => {
    const hash = file ? await sha256File(file) : await sha256Text(`${batchId}|${desc}|${affected}`);
    const sig = await program.methods
      .reportIncident(desc, affected, Array.from(hash))
      .accountsPartial({
        config: configPda(), member: memberPda(wallet!.publicKey), batch: batchKey, incident: incidentPda(batchKey, batch.incidentCount),
        authority: wallet!.publicKey, systemProgram: SystemProgram.programId,
      })
      .rpc();
    setDesc("");
    setTick((t) => t + 1);
    return sig;
  });

  return (
    <div className="stack">
      {frozen && <div className="banner banner-danger">⛔ BATCH {batchId} DIBEKUKAN (RECALL) — JANGAN DIBAGIKAN / DIKONSUMSI. Simpan boks untuk pemeriksaan.</div>}
      {!frozen && batch.flags & 3 ? <div className="banner banner-warn">⚠ Batch ini berstatus PERINGATAN. Periksa kondisi makanan sebelum dibagikan.</div> : null}
      <div className="grid grid-2">
        <Card title={<>Batch <span className="mono">{batchId}</span></>} actions={<StatusBadge status={batch.status} />}>
          <dl className="kv">
            <dt>Menu</dt><dd>{batch.menu}</dd>
            <dt>Selesai dimasak</dt><dd>{fmtTime(toNum(batch.cookedAt))}</dd>
            <dt>Sudah berlalu</dt><dd>{fmtDuration(nowSec() - toNum(batch.cookedAt))} (batas SOP {sop} menit)</dd>
            <dt>Peringatan</dt><dd><FlagChips flags={batch.flags} />{!batch.flags && "—"}</dd>
          </dl>
          <hr style={{ border: 0, borderTop: "1px solid var(--line)", margin: "14px 0" }} />
          {delivery === null ? (
            <div className="alert alert-warn">Batch ini tidak tercatat dikirim ke sekolah Anda. Hubungi SPPG.</div>
          ) : delivery && (
            <>
              <dl className="kv">
                <dt>Porsi untuk sekolah</dt><dd>{delivery.portions}</dd>
                <dt>Dikirim</dt><dd>{fmtTime(toNum(delivery.dispatchedAt))}</dd>
                <dt>Diterima</dt><dd>{fmtTime(toNum(delivery.receivedAt))}</dd>
                <dt>Dikonsumsi</dt><dd>{fmtTime(toNum(delivery.consumedAt))} {delivery.flags & 1 ? <span className="chip chip-warn">lewat batas SOP</span> : null}</dd>
              </dl>
              <div className="stack" style={{ gap: 10, marginTop: 12 }}>
                {!toNum(delivery.receivedAt) && <button className="btn" disabled={tx.busy} onClick={receive}>✔ Konfirmasi makanan diterima</button>}
                {!toNum(delivery.consumedAt) && (
                  <div>
                    <label>Jam konsumsi siswa</label>
                    <div className="row">
                      <input type="datetime-local" value={consumed} onChange={(e) => setConsumed(e.target.value)} style={{ width: 230 }} />
                      <button className="btn" disabled={tx.busy || frozen} onClick={consume}>Catat konsumsi</button>
                    </div>
                    <p className={`small ${elapsed > sop * 60 ? "" : "muted"}`} style={{ color: elapsed > sop * 60 ? "var(--warn)" : undefined }}>
                      Jeda masak → konsumsi: {fmtDuration(Math.max(0, elapsed))}
                      {elapsed > sop * 60 && " — melebihi batas SOP, smart contract akan menandai PERINGATAN"}
                    </p>
                  </div>
                )}
              </div>
            </>
          )}
          <TxMessage msg={tx.msg} />
        </Card>

        <Card title="Laporkan gejala / insiden (IncidentContract)">
          <div className="field">
            <label>Deskripsi gejala</label>
            <textarea maxLength={200} value={desc} onChange={(e) => setDesc(e.target.value)} placeholder="mis. 12 siswa kelas 4 mual & muntah ±1 jam setelah makan" />
          </div>
          <div className="fields-2">
            <div className="field"><label>Jumlah terdampak</label><input type="number" min={1} value={affected} onChange={(e) => setAffected(+e.target.value)} /></div>
            <div className="field"><label>Bukti (foto/dokumen, opsional)</label><input type="file" onChange={(e) => setFile(e.target.files?.[0] ?? null)} /></div>
          </div>
          <p className="small muted">File tidak diunggah ke blockchain — hanya <b>hash SHA-256</b>-nya yang dicatat on-chain sebagai bukti keaslian (file asli disimpan di IPFS / arsip instansi).</p>
          <button className="btn btn-danger" disabled={tx.busy || !desc} onClick={report}>Kirim laporan insiden</button>
        </Card>
      </div>
    </div>
  );
}
