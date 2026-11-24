"use client";

import { useEffect, useState } from "react";
import { PublicKey, SystemProgram } from "@solana/web3.js";
import { Card, NeedWallet, TxMessage } from "@/components/ui";
import { useSigap, useTx } from "@/lib/hooks";
import { ALL_ROLES, configPda, memberPda, ROLE_LABEL, ROLES, roleNames, RoleName, short, explorerAccount, PROGRAM_ID } from "@/lib/sigap";

/* eslint-disable @typescript-eslint/no-explicit-any */

export default function AdminPage() {
  const { program, wallet, config, isAdmin, loading, refresh } = useSigap();
  const tx = useTx();
  const [params, setParams] = useState({ sop: 240, dmin: 5, dmax: 60, dlimit: 60 });
  const [members, setMembers] = useState<any[]>([]);
  const [form, setForm] = useState({ wallet: "", name: "", roles: 0 });
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (config)
      setParams({ sop: config.sopMaxMinutes, dmin: config.dangerMinX10 / 10, dmax: config.dangerMaxX10 / 10, dlimit: config.dangerMaxMinutes });
  }, [config]);

  useEffect(() => {
    (program.account as any).member.all().then(setMembers).catch(() => setMembers([]));
  }, [program, tick]);

  if (!wallet) return <NeedWallet>Hubungkan wallet admin (BGN) untuk mengelola program.</NeedWallet>;
  if (loading) return <div className="empty">Memuat…</div>;

  const cfgArgs = () => ({
    sopMaxMinutes: Number(params.sop),
    dangerMinX10: Math.round(Number(params.dmin) * 10),
    dangerMaxX10: Math.round(Number(params.dmax) * 10),
    dangerMaxMinutes: Number(params.dlimit),
  });

  const initialize = () =>
    tx.run("Inisialisasi program", async () => {
      const sig = await program.methods
        .initialize(cfgArgs())
        .accountsPartial({ config: configPda(), admin: wallet.publicKey, systemProgram: SystemProgram.programId })
        .rpc();
      refresh();
      return sig;
    });

  const updateConfig = () =>
    tx.run("Simpan konfigurasi", async () => {
      const sig = await program.methods.updateConfig(cfgArgs()).accountsPartial({ config: configPda(), admin: wallet.publicKey }).rpc();
      refresh();
      return sig;
    });

  const setMember = (w: string, name: string, roles: number) =>
    tx.run("Simpan anggota", async () => {
      const pk = new PublicKey(w.trim());
      const sig = await program.methods
        .setMember(pk, name, roles)
        .accountsPartial({ config: configPda(), member: memberPda(pk), admin: wallet.publicKey, systemProgram: SystemProgram.programId })
        .rpc();
      refresh();
      setTick((t) => t + 1);
      return sig;
    });

  const ConfigForm = (
    <>
      <div className="fields-2">
        <div className="field">
          <label>Batas SOP masak → konsumsi (menit)</label>
          <input type="number" value={params.sop} onChange={(e) => setParams({ ...params, sop: +e.target.value })} />
        </div>
        <div className="field">
          <label>Ambang lama di zona bahaya (menit)</label>
          <input type="number" value={params.dlimit} onChange={(e) => setParams({ ...params, dlimit: +e.target.value })} />
        </div>
        <div className="field">
          <label>Zona bahaya: batas bawah (°C)</label>
          <input type="number" step="0.1" value={params.dmin} onChange={(e) => setParams({ ...params, dmin: +e.target.value })} />
        </div>
        <div className="field">
          <label>Zona bahaya: batas atas (°C)</label>
          <input type="number" step="0.1" value={params.dmax} onChange={(e) => setParams({ ...params, dmax: +e.target.value })} />
        </div>
      </div>
      <p className="small muted">
        Default mengikuti prinsip keamanan pangan: makanan matang aman bila disimpan &lt;5°C atau &gt;60°C. Suhu di antaranya adalah
        zona bahaya pertumbuhan bakteri.
      </p>
    </>
  );

  if (!config)
    return (
      <div className="stack">
        <div className="page-head">
          <h1>Inisialisasi SIGAP-MBG</h1>
          <p>Program sudah ter-deploy tetapi belum diinisialisasi. Wallet yang menginisialisasi menjadi <b>admin (BGN)</b> yang berwenang mendaftarkan instansi.</p>
        </div>
        <Card title="Parameter aturan smart contract">
          {ConfigForm}
          <button className="btn" disabled={tx.busy} onClick={initialize}>Inisialisasi sebagai Admin</button>
          <TxMessage msg={tx.msg} />
        </Card>
      </div>
    );

  return (
    <div className="stack">
      <div className="page-head">
        <h1>Admin · Tata kelola node</h1>
        <p>
          Meniru ledger <i>permissioned</i>: hanya wallet instansi yang didaftarkan admin yang dapat menulis data. Admin saat ini:{" "}
          <code>{config.admin}</code>{" "}
          <a href={explorerAccount(PROGRAM_ID)} target="_blank" rel="noreferrer" className="small">program ↗</a>
        </p>
      </div>

      {!isAdmin && <div className="banner banner-warn">Wallet Anda bukan admin. Anda hanya dapat melihat data di halaman ini.</div>}

      <div className="grid grid-2">
        <Card title="Daftarkan / ubah peran wallet">
          <div className="field">
            <label>Alamat wallet</label>
            <input value={form.wallet} onChange={(e) => setForm({ ...form, wallet: e.target.value })} placeholder="Pubkey Solana" />
          </div>
          <div className="field">
            <label>Nama instansi</label>
            <input value={form.name} maxLength={64} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="mis. SPPG Semarang Barat 01" />
          </div>
          <div className="field">
            <label>Peran</label>
            <div className="grid grid-3" style={{ gap: 6 }}>
              {(Object.keys(ROLES) as RoleName[]).map((r) => (
                <label key={r} className="check">
                  <input
                    type="checkbox"
                    checked={(form.roles & ROLES[r]) !== 0}
                    onChange={(e) => setForm({ ...form, roles: e.target.checked ? form.roles | ROLES[r] : form.roles & ~ROLES[r] })}
                  />
                  {ROLE_LABEL[r]}
                </label>
              ))}
            </div>
          </div>
          <div className="row">
            <button className="btn" disabled={!isAdmin || tx.busy || !form.wallet} onClick={() => setMember(form.wallet, form.name, form.roles)}>
              Simpan ke blockchain
            </button>
            <button
              className="btn btn-ghost"
              disabled={!isAdmin || tx.busy}
              onClick={() => setMember(wallet.publicKey.toBase58(), "Demo — semua peran", ALL_ROLES)}
              title="Untuk demo dengan satu wallet"
            >
              Beri saya semua peran (demo)
            </button>
          </div>
          <TxMessage msg={tx.msg} />
        </Card>

        <Card title="Parameter aturan smart contract">
          {ConfigForm}
          <button className="btn" disabled={!isAdmin || tx.busy} onClick={updateConfig}>Simpan konfigurasi</button>
        </Card>
      </div>

      <Card title={`Anggota terdaftar (${members.length})`}>
        <div className="table-wrap">
          <table>
            <thead>
              <tr><th>Nama</th><th>Wallet</th><th>Peran</th><th></th></tr>
            </thead>
            <tbody>
              {members.map(({ account: m }) => (
                <tr key={m.wallet.toBase58()}>
                  <td>{m.name || "—"}</td>
                  <td className="mono"><a href={explorerAccount(m.wallet)} target="_blank" rel="noreferrer">{short(m.wallet, 6)}</a></td>
                  <td>
                    {m.active ? roleNames(m.roles).map((r) => <span key={r} className="chip" style={{ marginRight: 4 }}>{ROLE_LABEL[r]}</span>) : <span className="chip chip-danger">Nonaktif</span>}
                  </td>
                  <td>
                    <button className="btn btn-sm btn-ghost" onClick={() => setForm({ wallet: m.wallet.toBase58(), name: m.name, roles: m.roles })}>Edit</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
