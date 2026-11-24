"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { Card, FlagChips, StatusBadge, enumIs } from "@/components/ui";
import TempChart from "@/components/TempChart";
import { useSigap } from "@/lib/hooks";
import {
  batchPda,
  computeTempChain,
  explorerAccount,
  fmtDuration,
  fmtTemp,
  fmtTime,
  isZeroHash,
  orderedReadings,
  recallPda,
  short,
  tempLogPda,
  toHex,
  toNum,
  Reading,
} from "@/lib/sigap";

/* eslint-disable @typescript-eslint/no-explicit-any */

export default function CekBatchPage() {
  const params = useParams<{ id: string }>();
  const batchId = decodeURIComponent(params.id ?? "");
  const { program, config } = useSigap();

  const [batch, setBatch] = useState<any>(undefined);
  const [deliveries, setDeliveries] = useState<any[]>([]);
  const [incidents, setIncidents] = useState<any[]>([]);
  const [recall, setRecall] = useState<any>(null);
  const [readings, setReadings] = useState<Reading[]>([]);
  const [members, setMembers] = useState<Record<string, string>>({});
  const [hashOk, setHashOk] = useState<boolean | null>(null);

  const batchKey = batchId ? batchPda(batchId) : null;

  useEffect(() => {
    if (!batchKey) return;
    let alive = true;
    (async () => {
      try {
        const b: any = await (program.account as any).batch.fetchNullable(batchKey);
        if (!alive) return;
        setBatch(b);
        if (!b) return;

        const [ds, incs, rec, log, ms] = await Promise.all([
          (program.account as any).delivery.all([{ memcmp: { offset: 8, bytes: batchKey.toBase58() } }]),
          (program.account as any).incident.all([{ memcmp: { offset: 8, bytes: batchKey.toBase58() } }]),
          (program.account as any).recall.fetchNullable(recallPda(batchKey)),
          (program.account as any).tempLog.fetchNullable(tempLogPda(batchKey)),
          (program.account as any).member.all(),
        ]);
        if (!alive) return;

        setDeliveries(ds);
        incs.sort((a: any, c: any) => toNum(a.account.reportedAt) - toNum(c.account.reportedAt));
        setIncidents(incs);
        setRecall(rec);

        const mMap: Record<string, string> = {};
        for (const m of ms) mMap[m.account.wallet.toBase58()] = m.account.name;
        setMembers(mMap);

        if (log) {
          const ord = orderedReadings(log);
          setReadings(ord);
          // Verifikasi integritas rantai hash jika semua pembacaan masih ada di ring buffer (<= 48)
          if (ord.length > 0 && ord.length === b.tempCount) {
            const calc = await computeTempChain(ord);
            if (alive) setHashOk(calc === toHex(b.tempLogHash));
          } else {
            setHashOk(null);
          }
        }
      } catch (e) {
        console.error(e);
        if (alive) setBatch(null);
      }
    })();
    return () => {
      alive = false;
    };
  }, [program, batchId]); // eslint-disable-line react-hooks/exhaustive-deps

  if (batch === undefined) return <div className="empty">Memuat data batch dari Solana…</div>;
  if (batch === null) {
    return (
      <div className="empty">
        <p>Batch <code>{batchId}</code> tidak ditemukan di blockchain.</p>
        <Link href="/cek" className="btn btn-ghost">Cek batch lain</Link>
      </div>
    );
  }

  const frozen = enumIs(batch.status, "dibekukan") || enumIs(batch.status, "ditarik");
  const warned = enumIs(batch.status, "peringatan");
  const safeLab = enumIs(batch.status, "dibebaskan");
  const nameOf = (pk: any) => members[pk.toBase58()] || short(pk);

  return (
    <div className="stack">
      <div className="row">
        <div>
          <h1>Batch <span className="mono">{batch.batchId}</span></h1>
          <p className="muted small" style={{ margin: 0 }}>
            Akun Solana:{" "}
            <a href={explorerAccount(batchKey!)} target="_blank" rel="noreferrer" className="mono">
              {batchKey!.toBase58()} ↗
            </a>
          </p>
        </div>
        <span className="spacer" />
        <StatusBadge status={batch.status} big />
      </div>

      {frozen && (
        <div className="banner banner-danger">
          ⛔ BATCH INI DIBEKUKAN / DITARIK — Jangan dikonsumsi. Telah dipicu recall otomatis lintas sekolah.
        </div>
      )}
      {!frozen && warned && (
        <div className="banner banner-warn">
          ⚠ BATCH BERSTATUS PERINGATAN — Smart contract mendeteksi pelanggaran batas waktu SOP atau suhu zona bahaya.
        </div>
      )}
      {safeLab && (
        <div className="banner banner-ok">
          ✔ AMAN (TERVERIFIKASI LAB BPOM) — Sampel retain dinyatakan aman berdasarkan hasil uji laboratorium.
        </div>
      )}
      {!frozen && !warned && !safeLab && (
        <div className="banner banner-ok">
          ✔ Tidak ada peringatan keamanan pangan pada batch ini.
        </div>
      )}

      <div className="grid grid-2">
        <Card title="Informasi Batch & Dapur SPPG">
          <dl className="kv">
            <dt>Menu</dt><dd>{batch.menu}</dd>
            <dt>Dapur SPPG</dt><dd>{nameOf(batch.sppg)}</dd>
            <dt>Pemasok bahan</dt><dd>{batch.supplier}</dd>
            <dt>Kedaluwarsa bahan</dt><dd>{fmtTime(toNum(batch.ingredientsExpiry))}</dd>
            <dt>Jam selesai masak</dt><dd>{fmtTime(toNum(batch.cookedAt))}</dd>
            <dt>ID Sampel Retain</dt><dd className="mono">{batch.retainSampleId}</dd>
            <dt>Total porsi</dt><dd>{batch.portions} porsi</dd>
            <dt>Peringatan</dt><dd>{batch.flags ? <FlagChips flags={batch.flags} /> : "Tidak ada"}</dd>
          </dl>
        </Card>

        <Card title="Ringkasan Rantai Dingin (ColdChainContract)">
          <dl className="kv">
            <dt>Total pembacaan</dt><dd>{batch.tempCount} kali</dd>
            <dt>Suhu terakhir</dt><dd>{batch.tempCount ? `${fmtTemp(batch.lastTempX10)} (${fmtTime(toNum(batch.lastTempAt))})` : "—"}</dd>
            <dt>Rentang suhu</dt><dd>{batch.tempCount ? `${fmtTemp(batch.minTempX10)} – ${fmtTemp(batch.maxTempX10)}` : "—"}</dd>
            <dt>Durasi zona bahaya</dt>
            <dd>
              {fmtDuration(batch.dangerSeconds)}
              {config ? ` (ambang maks ${config.dangerMaxMinutes} menit)` : ""}
            </dd>
            <dt>Hash rantai suhu</dt>
            <dd className="mono">
              {isZeroHash(batch.tempLogHash) ? "—" : `${toHex(batch.tempLogHash).slice(0, 32)}…`}
              {hashOk === true && <div className="chip" style={{ marginTop: 4 }}>✔ Hash terverifikasi cocok</div>}
              {hashOk === false && <div className="chip chip-danger" style={{ marginTop: 4 }}>✖ Hash tidak cocok</div>}
            </dd>
          </dl>
        </Card>
      </div>

      <Card title="Grafik Suhu Sensor IoT">
        <TempChart
          readings={readings}
          dangerMin={config?.dangerMinX10 ?? 50}
          dangerMax={config?.dangerMaxX10 ?? 600}
        />
      </Card>

      <div className="grid grid-2">
        <Card title={`Distribusi ke Sekolah (${deliveries.length})`}>
          {deliveries.length === 0 ? (
            <p className="muted">Belum ada catatan pengiriman.</p>
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr><th>Sekolah</th><th>Porsi</th><th>Dikirim</th><th>Diterima</th><th>Dikonsumsi</th></tr>
                </thead>
                <tbody>
                  {deliveries.map(({ account: d }) => (
                    <tr key={d.school.toBase58()}>
                      <td>{nameOf(d.school)}</td>
                      <td>{d.portions}</td>
                      <td className="small">{fmtTime(toNum(d.dispatchedAt))}</td>
                      <td className="small">{fmtTime(toNum(d.receivedAt))}</td>
                      <td className="small">
                        {fmtTime(toNum(d.consumedAt))}{" "}
                        {d.flags & 1 ? <span className="chip chip-warn">lewat SOP</span> : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        <Card title="Insiden, Recall & Uji Lab BPOM">
          {recall && (
            <div className="alert alert-err" style={{ marginTop: 0, marginBottom: 12 }}>
              <b>Recall aktif</b> · Dibekukan oleh {nameOf(recall.frozenBy)} pada {fmtTime(toNum(recall.frozenAt))} ({recall.affectedDeliveries} sekolah terdampak).
              <br />
              Status lab BPOM: <b>{Object.keys(recall.labResult)[0].toUpperCase()}</b>
              {!isZeroHash(recall.labHash) && (
                <>
                  <br />
                  Hash hasil lab: <code className="mono">{toHex(recall.labHash).slice(0, 28)}…</code>
                </>
              )}
            </div>
          )}

          {incidents.length === 0 ? (
            <p className="muted">Tidak ada laporan insiden untuk batch ini.</p>
          ) : (
            <ul className="timeline">
              {incidents.map(({ publicKey, account: inc }) => {
                const st = Object.keys(inc.status)[0];
                return (
                  <li key={publicKey.toBase58()} className={st === "terverifikasi" ? "danger" : "warn"}>
                    <div className="t">
                      {fmtTime(toNum(inc.reportedAt))} · Pelapor {nameOf(inc.reporter)} · <b>{st.toUpperCase()}</b>
                    </div>
                    <div>{inc.description} ({inc.affectedCount} terdampak)</div>
                    {!isZeroHash(inc.evidenceHash) && (
                      <div className="small muted">Hash bukti: <code>{toHex(inc.evidenceHash).slice(0, 20)}…</code></div>
                    )}
                    {toNum(inc.verifiedAt) > 0 && (
                      <div className="small muted">
                        Verifikasi {nameOf(inc.verifier)} ({fmtTime(toNum(inc.verifiedAt))}): “{inc.note}”
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}
