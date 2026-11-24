"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Card, FlagChips, StatusBadge } from "@/components/ui";
import { useSigap } from "@/lib/hooks";
import { explorerAccount, fmtTemp, fmtTime, PROGRAM_ID, short, toNum } from "@/lib/sigap";

/* eslint-disable @typescript-eslint/no-explicit-any */

export default function Home() {
  const { program, config } = useSigap();
  const router = useRouter();
  const [batches, setBatches] = useState<any[] | null>(null);
  const [q, setQ] = useState("");

  useEffect(() => {
    (async () => {
      try {
        const all = await (program.account as any).batch.all();
        all.sort((a: any, b: any) => toNum(b.account.createdAt) - toNum(a.account.createdAt));
        setBatches(all);
      } catch (e) {
        console.error(e);
        setBatches([]);
      }
    })();
  }, [program]);

  const frozen = batches?.filter((b) => ["dibekukan", "ditarik"].includes(Object.keys(b.account.status)[0])).length ?? 0;
  const warn = batches?.filter((b) => b.account.flags & 3).length ?? 0;

  return (
    <>
      <div className="hero">
        <h1>SIGAP-MBG</h1>
        <p>
          Blockchain + IoT untuk ketertelusuran keamanan pangan <b>per-batch</b> pada Program Makan Bergizi Gratis.
          Setiap batch dapur SPPG, rekaman suhu sensor, jam konsumsi di sekolah, laporan insiden, dan recall otomatis
          dicatat permanen di <b>Solana</b> — satu sumber kebenaran untuk BGN, Kemenkes/Dinkes, BPOM, dan Pemda.
        </p>
        <form
          className="row"
          style={{ marginTop: 16, maxWidth: 520 }}
          onSubmit={(e) => {
            e.preventDefault();
            if (q.trim()) router.push(`/cek/${encodeURIComponent(q.trim())}`);
          }}
        >
          <input placeholder="Masukkan ID batch, mis. SPPG01-20261124-A" value={q} onChange={(e) => setQ(e.target.value)} style={{ flex: 1 }} />
          <button className="btn">Cek Batch</button>
        </form>
      </div>

      <div className="grid grid-4" style={{ marginBottom: 18 }}>
        <div className="card stat"><div className="v">{config?.batchCount ?? "–"}</div><div className="l">Batch tercatat on-chain</div></div>
        <div className="card stat"><div className="v" style={{ color: "var(--warn)" }}>{batches ? warn : "–"}</div><div className="l">Batch berstatus peringatan</div></div>
        <div className="card stat"><div className="v" style={{ color: "var(--danger)" }}>{config?.incidentCount ?? "–"}</div><div className="l">Laporan insiden</div></div>
        <div className="card stat"><div className="v" style={{ color: "var(--danger)" }}>{batches ? frozen : "–"}</div><div className="l">Batch dibekukan / ditarik</div></div>
      </div>

      <Card title="Alur data dari dapur SPPG sampai ke siswa">
        <div className="flow">
          <div><b>1. Bahan masuk</b>Pemasok & tanggal kedaluwarsa dicatat</div>
          <div><b>2. Masak</b>Jam selesai masak + ID sampel retain</div>
          <div><b>3. Kemas</b>QR batch ditempel di boks / ompreng</div>
          <div><b>4. Kirim</b>Sensor suhu merekam tiap 5 menit</div>
          <div><b>5. Terima</b>Sekolah scan QR; jam konsumsi tercatat</div>
        </div>
        <p className="small muted" style={{ marginBottom: 0 }}>
          Jika ada laporan gejala: <b>IncidentContract</b> mencatat laporan sekali untuk semua instansi →
          Dinkes memverifikasi → <b>RecallContract</b> membekukan batch yang sama di semua sekolah → BPOM mengunggah hash hasil uji lab sampel retain.
        </p>
      </Card>

      <div style={{ height: 18 }} />

      <Card
        title="Batch terbaru"
        actions={
          <a className="small" href={explorerAccount(PROGRAM_ID)} target="_blank" rel="noreferrer">
            Program {short(PROGRAM_ID)} ↗
          </a>
        }
      >
        {!config && batches?.length === 0 && (
          <div className="alert alert-info">
            Program belum diinisialisasi atau belum ada batch. Mulai dari <Link href="/admin">Admin</Link> → <Link href="/sppg">SPPG</Link>.
          </div>
        )}
        {batches === null ? (
          <p className="muted">Memuat dari Solana…</p>
        ) : batches.length === 0 ? (
          <p className="muted">Belum ada batch.</p>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>ID Batch</th><th>Menu</th><th>Dimasak</th><th>Suhu terakhir</th><th>Kirim</th><th>Status</th><th></th>
                </tr>
              </thead>
              <tbody>
                {batches.map(({ publicKey, account: b }) => (
                  <tr key={publicKey.toBase58()}>
                    <td className="mono"><b>{b.batchId}</b></td>
                    <td>{b.menu}</td>
                    <td>{fmtTime(toNum(b.cookedAt))}</td>
                    <td>{b.tempCount > 0 ? fmtTemp(b.lastTempX10) : "—"}</td>
                    <td>{b.deliveryCount} sekolah</td>
                    <td>
                      <StatusBadge status={b.status} /> <FlagChips flags={b.flags} />
                    </td>
                    <td><Link className="btn btn-sm btn-ghost" href={`/cek/${encodeURIComponent(b.batchId)}`}>Detail</Link></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  );
}
