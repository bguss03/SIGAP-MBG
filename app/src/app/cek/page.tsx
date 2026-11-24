"use client";

import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import { Card } from "@/components/ui";
import QrScanner from "@/components/QrScanner";
import { parseBatchQr } from "@/lib/sigap";

export default function CekIndexPage() {
  const router = useRouter();
  const [id, setId] = useState("");

  const go = useCallback(
    (raw: string) => {
      const parsed = parseBatchQr(raw);
      if (parsed) router.push(`/cek/${encodeURIComponent(parsed)}`);
    },
    [router],
  );

  return (
    <div className="stack">
      <div className="page-head">
        <h1>Cek Publik · Orang Tua & Masyarakat</h1>
        <p>
          Scan QR pada boks/ompreng MBG atau masukkan ID batch untuk memeriksa status keamanan pangan,
          riwayat suhu rantai dingin, dan bukti verifikasi on-chain di Solana. Tidak perlu wallet untuk melihat.
        </p>
      </div>

      <div className="grid grid-2">
        <Card title="Masukkan ID Batch">
          <form
            className="row"
            onSubmit={(e) => {
              e.preventDefault();
              go(id);
            }}
          >
            <input
              placeholder="Contoh: SPPG01-20261124-ABCD"
              value={id}
              onChange={(e) => setId(e.target.value)}
              style={{ flex: 1 }}
            />
            <button className="btn">Periksa</button>
          </form>
          <p className="small muted" style={{ marginBottom: 0 }}>
            Data siswa bersifat privat dan tidak pernah disimpan di blockchain — publik hanya melihat status keamanan per-batch.
          </p>
        </Card>

        <Card title="Scan QR Boks / Ompreng">
          <QrScanner onResult={go} />
        </Card>
      </div>
    </div>
  );
}
