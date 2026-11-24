"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Connection, Keypair, LAMPORTS_PER_SOL, PublicKey, SystemProgram, Transaction, VersionedTransaction } from "@solana/web3.js";
import type { AnchorWallet } from "@solana/wallet-adapter-react";
import { QRCodeCanvas } from "qrcode.react";
import { Card, FlagChips, RoleGate, StatusBadge, TxMessage } from "@/components/ui";
import TempChart from "@/components/TempChart";
import { useSigap, useTx } from "@/lib/hooks";
import {
  batchPda, BN, configPda, deliveryPda, fmtDuration, fmtTemp, fmtTime, fromDatetimeLocal, getProgram, memberPda, nowSec,
  orderedReadings, ROLES, short, tempLogPda, toDatetimeLocal, toHex, toNum, SigapProgram,
} from "@/lib/sigap";

/* eslint-disable @typescript-eslint/no-explicit-any */

const today = () => new Date().toISOString().slice(0, 10).replace(/-/g, "");
const rand = () => Math.random().toString(36).slice(2, 6).toUpperCase();

export default function SppgPage() {
  return (
    <div className="stack">
      <div className="page-head">
        <h1>Dapur SPPG</h1>
        <p>Catat batch masakan (bahan, jam selesai masak, sampel retain), cetak QR untuk boks/ompreng, kirim ke sekolah, dan unggah data sensor suhu ke blockchain.</p>
      </div>
      <RoleGate role={ROLES.SPPG} label="Dapur SPPG">
        <SppgInner />
      </RoleGate>
    </div>
  );
}

function SppgInner() {
  const { program, wallet, config } = useSigap();
  const tx = useTx();
  const [batches, setBatches] = useState<any[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const reload = () => setTick((t) => t + 1);

  const [f, setF] = useState(() => {
    const id = `SPPG01-${today()}-${rand()}`;
    const d = new Date(Date.now() + 3 * 864e5).toISOString().slice(0, 10);
    return { id, menu: "Nasi, ayam goreng, sayur bayam, pisang", supplier: "CV Pangan Sehat (ayam), UD Tani Makmur (sayur)", expiry: d, cooked: toDatetimeLocal(nowSec() - 2 * 3600), retain: `RS-${id}`, portions: 300 };
  });

  useEffect(() => {
    if (!wallet) return;
    (program.account as any).batch.all().then((all: any[]) => {
      const mine = all.filter((b) => b.account.sppg.equals(wallet.publicKey)).sort((a, b) => toNum(b.account.createdAt) - toNum(a.account.createdAt));
      setBatches(mine);
    });
  }, [program, wallet, tick]);

  const create = () =>
    tx.run("Buat batch", async () => {
      const batch = batchPda(f.id);
      const sig = await program.methods
        .createBatch(f.id, f.menu, f.supplier, new BN(Math.floor(new Date(f.expiry + "T23:59:00").getTime() / 1000)), new BN(fromDatetimeLocal(f.cooked)), f.retain, f.portions)
        .accountsPartial({
          config: configPda(), member: memberPda(wallet!.publicKey), batch, tempLog: tempLogPda(batch), authority: wallet!.publicKey, systemProgram: SystemProgram.programId,
        })
        .rpc();
      setSelected(f.id);
      const id = `SPPG01-${today()}-${rand()}`;
      setF({ ...f, id, retain: `RS-${id}` });
      reload();
      return sig;
    });

  const sel = batches.find((b) => b.account.batchId === selected);

  return (
    <>
      <div className="grid grid-2">
        <Card title="1–2 · Batch baru (bahan masuk & selesai masak)">
          <div className="fields-2">
            <div className="field"><label>ID Batch</label><input value={f.id} maxLength={32} onChange={(e) => setF({ ...f, id: e.target.value, retain: `RS-${e.target.value}` })} /></div>
            <div className="field"><label>ID Sampel Retain</label><input value={f.retain} maxLength={32} onChange={(e) => setF({ ...f, retain: e.target.value })} /></div>
          </div>
          <div className="field"><label>Menu</label><input value={f.menu} maxLength={64} onChange={(e) => setF({ ...f, menu: e.target.value })} /></div>
          <div className="field"><label>Pemasok bahan</label><input value={f.supplier} maxLength={64} onChange={(e) => setF({ ...f, supplier: e.target.value })} /></div>
          <div className="fields-2">
            <div className="field"><label>Kedaluwarsa bahan (paling awal)</label><input type="date" value={f.expiry} onChange={(e) => setF({ ...f, expiry: e.target.value })} /></div>
            <div className="field"><label>Jam selesai masak</label><input type="datetime-local" value={f.cooked} onChange={(e) => setF({ ...f, cooked: e.target.value })} /></div>
          </div>
          <div className="field"><label>Jumlah porsi</label><input type="number" value={f.portions} onChange={(e) => setF({ ...f, portions: +e.target.value })} /></div>
          <button className="btn" disabled={tx.busy} onClick={create}>Catat batch ke Solana</button>
          <TxMessage msg={tx.msg} />
        </Card>

        <Card title={`Batch milik dapur ini (${batches.length})`}>
          {batches.length === 0 ? (
            <p className="muted">Belum ada batch.</p>
          ) : (
            <div className="table-wrap" style={{ maxHeight: 460, overflowY: "auto" }}>
              <table>
                <tbody>
                  {batches.map(({ account: b }) => (
                    <tr key={b.batchId} onClick={() => setSelected(b.batchId)} style={{ cursor: "pointer", background: selected === b.batchId ? "var(--brand-soft)" : undefined }}>
                      <td><b className="mono">{b.batchId}</b><div className="small muted">{b.menu}</div></td>
                      <td className="small">{fmtTime(toNum(b.cookedAt))}</td>
                      <td><StatusBadge status={b.status} /><br /><FlagChips flags={b.flags} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>

      {sel && config && <BatchPanel key={sel.account.batchId} batch={sel} program={program} wallet={wallet!} cfg={config} onChange={reload} />}
    </>
  );
}

function BatchPanel({ batch, program, wallet, cfg, onChange }: { batch: any; program: SigapProgram; wallet: AnchorWallet; cfg: any; onChange: () => void }) {
  const b = batch.account;
  const batchKey: PublicKey = batch.publicKey;
  const tx = useTx();
  const [deliveries, setDeliveries] = useState<any[]>([]);
  const [schools, setSchools] = useState<any[]>([]);
  const [school, setSchool] = useState("");
  const [portions, setPortions] = useState(100);
  const [log, setLog] = useState<any>(null);
  const [tick, setTick] = useState(0);
  const url = typeof window !== "undefined" ? `${window.location.origin}/cek/${encodeURIComponent(b.batchId)}` : "";

  useEffect(() => {
    (program.account as any).delivery.all([{ memcmp: { offset: 8, bytes: batchKey.toBase58() } }]).then(setDeliveries);
    (program.account as any).member.all().then((m: any[]) => setSchools(m.filter((x) => x.account.active && x.account.roles & ROLES.SEKOLAH)));
    (program.account as any).tempLog.fetch(tempLogPda(batchKey)).then(setLog);
  }, [program, batchKey, tick]);

  const refresh = () => { setTick((t) => t + 1); onChange(); };

  const dispatch = () =>
    tx.run("Kirim ke sekolah", async () => {
      const s = new PublicKey(school.trim());
      const sig = await program.methods
        .dispatchBatch(s, portions)
        .accountsPartial({ member: memberPda(wallet.publicKey), batch: batchKey, delivery: deliveryPda(batchKey, s), authority: wallet.publicKey, systemProgram: SystemProgram.programId })
        .rpc();
      refresh();
      return sig;
    });

  const schoolName = (pk: PublicKey) => schools.find((s) => s.account.wallet.equals(pk))?.account.name || short(pk);

  return (
    <div className="grid grid-2">
      <Card title={<>Batch <span className="mono">{b.batchId}</span></>} actions={<StatusBadge status={b.status} />}>
        <div className="row" style={{ alignItems: "flex-start" }}>
          <div className="qr-box" id="qr-print">
            <QRCodeCanvas value={url} size={150} marginSize={1} />
            <div className="id">{b.batchId}</div>
            <div className="small muted">SIGAP-MBG · scan untuk cek</div>
          </div>
          <div style={{ flex: 1, minWidth: 220 }}>
            <dl className="kv" style={{ gridTemplateColumns: "120px 1fr" }}>
              <dt>Menu</dt><dd>{b.menu}</dd>
              <dt>Dimasak</dt><dd>{fmtTime(toNum(b.cookedAt))}</dd>
              <dt>Sampel retain</dt><dd className="mono">{b.retainSampleId}</dd>
              <dt>Porsi</dt><dd>{b.portions}</dd>
              <dt>Suhu</dt><dd>{b.tempCount ? `${fmtTemp(b.lastTempX10)} (min ${fmtTemp(b.minTempX10)}, maks ${fmtTemp(b.maxTempX10)})` : "—"}</dd>
              <dt>Zona bahaya</dt><dd>{fmtDuration(b.dangerSeconds)} / ambang {cfg.dangerMaxMinutes} menit</dd>
            </dl>
            <FlagChips flags={b.flags} />
          </div>
        </div>
        <div className="row" style={{ marginTop: 12 }}>
          <button className="btn btn-ghost btn-sm" onClick={() => printQr(b.batchId)}>🖨 Cetak QR</button>
          <a className="btn btn-ghost btn-sm" href={url} target="_blank" rel="noreferrer">Halaman publik ↗</a>
        </div>

        <h3 style={{ marginTop: 18 }}>3–4 · Kirim ke sekolah</h3>
        <div className="fields-2">
          <div className="field">
            <label>Sekolah tujuan (wallet)</label>
            <input list="schools" value={school} onChange={(e) => setSchool(e.target.value)} placeholder="Pubkey wallet sekolah" />
            <datalist id="schools">
              {schools.map((s) => <option key={s.account.wallet.toBase58()} value={s.account.wallet.toBase58()}>{s.account.name}</option>)}
            </datalist>
          </div>
          <div className="field"><label>Porsi</label><input type="number" value={portions} onChange={(e) => setPortions(+e.target.value)} /></div>
        </div>
        <button className="btn" disabled={tx.busy || !school} onClick={dispatch}>Catat pengiriman</button>
        <TxMessage msg={tx.msg} />
        {deliveries.length > 0 && (
          <table style={{ marginTop: 12 }}>
            <thead><tr><th>Sekolah</th><th>Porsi</th><th>Dikirim</th><th>Diterima</th><th>Dikonsumsi</th></tr></thead>
            <tbody>
              {deliveries.map(({ account: d }) => (
                <tr key={d.school.toBase58()}>
                  <td>{schoolName(d.school)}</td><td>{d.portions}</td>
                  <td className="small">{fmtTime(toNum(d.dispatchedAt))}</td>
                  <td className="small">{fmtTime(toNum(d.receivedAt))}</td>
                  <td className="small">{fmtTime(toNum(d.consumedAt))} {d.flags & 1 ? <span className="chip chip-warn">lewat SOP</span> : null}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      <Card title="4 · Sensor suhu boks (ColdChainContract)">
        {log && <TempChart readings={orderedReadings(log)} dangerMin={cfg.dangerMinX10} dangerMax={cfg.dangerMaxX10} />}
        <SensorSimulator batch={b} batchKey={batchKey} program={program} wallet={wallet} onDone={refresh} />
      </Card>
    </div>
  );
}

// ----------------------------------------------------------------------------
// Simulasi perangkat IoT
// ----------------------------------------------------------------------------

type Scenario = "panas" | "buruk" | "dingin";
const SCENARIO_LABEL: Record<Scenario, string> = {
  panas: "Normal — hot holding (>60°C)",
  buruk: "Buruk — boks tidak berinsulasi, mendingin ke suhu ruang",
  dingin: "Normal — rantai dingin (<5°C)",
};

function scenarioTemp(s: Scenario, minutes: number) {
  const noise = (Math.random() - 0.5) * 1.2;
  let t: number;
  if (s === "panas") t = 75 - minutes * 0.045;
  else if (s === "buruk") t = 29 + 46 * Math.exp(-minutes / 55);
  else t = 3 + Math.sin(minutes / 20);
  return Math.round((t + noise) * 10);
}

function burnerWallet(kp: Keypair): AnchorWallet {
  const sign = <T extends Transaction | VersionedTransaction>(t: T) => {
    if ("version" in t) (t as VersionedTransaction).sign([kp]);
    else (t as Transaction).partialSign(kp);
    return t;
  };
  return { publicKey: kp.publicKey, signTransaction: async (t) => sign(t), signAllTransactions: async (ts) => ts.map(sign) } as AnchorWallet;
}

function useBurner() {
  const [kp, setKp] = useState<Keypair | null>(null);
  useEffect(() => {
    let raw = localStorage.getItem("sigap-sensor-key");
    if (!raw) {
      raw = JSON.stringify(Array.from(Keypair.generate().secretKey));
      localStorage.setItem("sigap-sensor-key", raw);
    }
    setKp(Keypair.fromSecretKey(Uint8Array.from(JSON.parse(raw))));
  }, []);
  return kp;
}

function SensorSimulator({ batch, batchKey, program, wallet, onDone }: { batch: any; batchKey: PublicKey; program: SigapProgram; wallet: AnchorWallet; onDone: () => void }) {
  const tx = useTx();
  const setTxMsg = tx.setMsg;
  const { isAdmin } = useSigap();
  const burner = useBurner();
  const [useDevice, setUseDevice] = useState(false);
  const [scenario, setScenario] = useState<Scenario>("panas");
  const [manual, setManual] = useState(65);
  const [deviceInfo, setDeviceInfo] = useState<{ balance: number; registered: boolean } | null>(null);
  const [live, setLive] = useState(false);
  const lastTs = useRef<number>(toNum(batch.lastTempAt));
  const cookedAt = toNum(batch.cookedAt);
  const connection: Connection = program.provider.connection;

  useEffect(() => { lastTs.current = toNum(batch.lastTempAt); }, [batch]);

  const signerProgram = useMemo(
    () => (useDevice && burner ? getProgram(connection, burnerWallet(burner)) : program),
    [useDevice, burner, connection, program],
  );
  const signer = useDevice && burner ? burner.publicKey : wallet.publicKey;

  const loadDevice = useCallback(async () => {
    if (!burner) return;
    const [bal, m] = await Promise.all([
      connection.getBalance(burner.publicKey),
      (program.account as any).member.fetchNullable(memberPda(burner.publicKey)),
    ]);
    setDeviceInfo({ balance: bal / LAMPORTS_PER_SOL, registered: !!m && m.active && (m.roles & ROLES.SENSOR) !== 0 });
  }, [burner, connection, program]);
  useEffect(() => { loadDevice(); }, [loadDevice]);

  const send = useCallback(
    async (readings: { ts: number; tempX10: number }[]) => {
      let sig = "";
      for (let i = 0; i < readings.length; i += 24) {
        const chunk = readings.slice(i, i + 24).map((r) => ({ ts: new BN(r.ts), tempX10: r.tempX10 }));
        sig = await signerProgram.methods
          .recordTemperatures(chunk)
          .accountsPartial({ config: configPda(), member: memberPda(signer), batch: batchKey, tempLog: tempLogPda(batchKey), authority: signer })
          .rpc();
      }
      lastTs.current = readings[readings.length - 1].ts;
      return sig;
    },
    [signerProgram, signer, batchKey],
  );

  const backfill = () =>
    tx.run("Unggah buffer sensor", async () => {
      const now = nowSec();
      let ts = lastTs.current ? lastTs.current + 300 : cookedAt;
      const rs: { ts: number; tempX10: number }[] = [];
      while (ts <= now && rs.length < 96) {
        rs.push({ ts, tempX10: scenarioTemp(scenario, (ts - cookedAt) / 60) });
        ts += 300;
      }
      if (rs.length === 0) throw new Error("Belum ada interval 5 menit baru sejak pembacaan terakhir");
      const sig = await send(rs);
      onDone();
      return sig;
    });

  const sendManual = () =>
    tx.run("Kirim pembacaan", async () => {
      const ts = Math.max(nowSec(), lastTs.current + 1);
      const sig = await send([{ ts, tempX10: Math.round(manual * 10) }]);
      onDone();
      return sig;
    });

  // Mode live: perangkat sensor mengirim 1 pembacaan tiap 15 detik (tanpa popup wallet)
  useEffect(() => {
    if (!live) return;
    const id = setInterval(async () => {
      try {
        const ts = Math.max(nowSec(), lastTs.current + 1);
        await send([{ ts, tempX10: scenarioTemp(scenario, (ts - cookedAt) / 60) }]);
        onDone();
      } catch (e) {
        console.error(e);
        setLive(false);
        setTxMsg({ kind: "err", text: "Mode live berhenti: " + (e as Error).message });
      }
    }, 15000);
    return () => clearInterval(id);
  }, [live, send, scenario, cookedAt, onDone, setTxMsg]);

  const fund = () =>
    tx.run("Isi saldo perangkat 0,02 SOL", async () => {
      const t = new Transaction().add(SystemProgram.transfer({ fromPubkey: wallet.publicKey, toPubkey: burner!.publicKey, lamports: 0.02 * LAMPORTS_PER_SOL }));
      const sig = await program.provider.sendAndConfirm!(t);
      loadDevice();
      return sig;
    });

  const register = () =>
    tx.run("Daftarkan perangkat sebagai Sensor", async () => {
      const sig = await program.methods
        .setMember(burner!.publicKey, "Sensor boks " + burner!.publicKey.toBase58().slice(0, 4), ROLES.SENSOR)
        .accountsPartial({ config: configPda(), member: memberPda(burner!.publicKey), admin: wallet.publicKey, systemProgram: SystemProgram.programId })
        .rpc();
      loadDevice();
      return sig;
    });

  const deviceReady = !!deviceInfo && deviceInfo.registered && deviceInfo.balance > 0.001;

  return (
    <div style={{ marginTop: 12 }}>
      <div className="field">
        <label>Penandatangan data sensor</label>
        <div className="row">
          <label className="check"><input type="radio" checked={!useDevice} onChange={() => { setUseDevice(false); setLive(false); }} /> Wallet SPPG (gateway)</label>
          <label className="check"><input type="radio" checked={useDevice} onChange={() => setUseDevice(true)} /> Perangkat IoT (keypair simulasi)</label>
        </div>
      </div>
      {useDevice && burner && (
        <div className="alert alert-info small">
          Perangkat: <code>{burner.publicKey.toBase58()}</code>
          <br />
          Saldo: {deviceInfo?.balance.toFixed(4) ?? "…"} SOL · Peran Sensor: {deviceInfo?.registered ? "✅ terdaftar" : "❌ belum"}
          <div className="row" style={{ marginTop: 6 }}>
            <button className="btn btn-sm btn-blue" disabled={tx.busy} onClick={fund}>Isi 0,02 SOL</button>
            {!deviceInfo?.registered && <button className="btn btn-sm btn-blue" disabled={tx.busy || !isAdmin} onClick={register} title={isAdmin ? "" : "Hanya admin"}>Daftarkan sebagai Sensor</button>}
          </div>
        </div>
      )}
      <div className="field">
        <label>Skenario simulasi</label>
        <select value={scenario} onChange={(e) => setScenario(e.target.value as Scenario)}>
          {(Object.keys(SCENARIO_LABEL) as Scenario[]).map((s) => <option key={s} value={s}>{SCENARIO_LABEL[s]}</option>)}
        </select>
      </div>
      <div className="row">
        <button className="btn" disabled={tx.busy || (useDevice && !deviceReady)} onClick={backfill}>
          Unggah buffer (tiap 5 menit sejak {lastTs.current ? "data terakhir" : "jam masak"})
        </button>
        {useDevice && (
          <button className={`btn ${live ? "btn-danger" : "btn-blue"}`} disabled={!deviceReady} onClick={() => setLive(!live)}>
            {live ? "■ Hentikan live" : "▶ Live tiap 15 dtk"}
          </button>
        )}
      </div>
      <div className="row" style={{ marginTop: 10 }}>
        <input type="number" step="0.1" value={manual} onChange={(e) => setManual(+e.target.value)} style={{ width: 110 }} />
        <span>°C</span>
        <button className="btn btn-ghost" disabled={tx.busy || (useDevice && !deviceReady)} onClick={sendManual}>Kirim 1 pembacaan sekarang</button>
      </div>
      <p className="small muted">
        Program menghitung durasi kumulatif di zona bahaya dan membuat <b>hash berantai</b> dari setiap pembacaan. Total {batch.tempCount} pembacaan · hash terakhir{" "}
        <code>{toHex(batch.tempLogHash).slice(0, 16)}…</code>
      </p>
      <TxMessage msg={tx.msg} />
    </div>
  );
}

function printQr(id: string) {
  const canvas = document.querySelector<HTMLCanvasElement>("#qr-print canvas");
  if (!canvas) return;
  const w = window.open("", "_blank", "width=420,height=520");
  if (!w) return;
  w.document.write(
    `<html><body style="font-family:sans-serif;text-align:center;padding:30px"><img src="${canvas.toDataURL()}" width="260"/><h2 style="font-family:monospace">${id}</h2><p>SIGAP-MBG · Scan untuk cek keamanan batch</p><script>setTimeout(()=>print(),300)</script></body></html>`,
  );
}
