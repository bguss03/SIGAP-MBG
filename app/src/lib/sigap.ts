import { AnchorProvider, Program, BN, type Idl } from "@anchor-lang/core";
import { Connection, PublicKey } from "@solana/web3.js";
import type { AnchorWallet } from "@solana/wallet-adapter-react";
import { Buffer } from "buffer";
import idlJson from "@/idl/sigap_mbg.json";

export const IDL = idlJson as Idl;
export const PROGRAM_ID = new PublicKey((idlJson as { address: string }).address);
export const RPC_URL = process.env.NEXT_PUBLIC_RPC_URL || "https://api.devnet.solana.com";
export const CLUSTER = process.env.NEXT_PUBLIC_CLUSTER || "devnet";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type SigapProgram = Program<any>;

// ----------------------------------------------------------------------------
// Peran & flag (harus sama dengan konstanta di program Rust)
// ----------------------------------------------------------------------------
export const ROLES = {
  SPPG: 1 << 0,
  SEKOLAH: 1 << 1,
  DINKES: 1 << 2,
  BPOM: 1 << 3,
  SENSOR: 1 << 4,
  BGN: 1 << 5,
} as const;
export type RoleName = keyof typeof ROLES;
export const ROLE_LABEL: Record<RoleName, string> = {
  SPPG: "Dapur SPPG",
  SEKOLAH: "Sekolah",
  DINKES: "Dinkes / Puskesmas",
  BPOM: "BPOM",
  SENSOR: "Sensor IoT",
  BGN: "BGN",
};
export const ALL_ROLES = Object.values(ROLES).reduce((a, b) => a | b, 0);

export const FLAGS = { TIME_EXCEEDED: 1, TEMP_DANGER: 2, INCIDENT: 4 } as const;

export function roleNames(mask: number): RoleName[] {
  return (Object.keys(ROLES) as RoleName[]).filter((k) => (mask & ROLES[k]) !== 0);
}

// ----------------------------------------------------------------------------
// Program
// ----------------------------------------------------------------------------
const READONLY_WALLET = {
  publicKey: PublicKey.default,
  signTransaction: async () => {
    throw new Error("Hubungkan wallet terlebih dahulu");
  },
  signAllTransactions: async () => {
    throw new Error("Hubungkan wallet terlebih dahulu");
  },
} as unknown as AnchorWallet;

export function getProgram(connection: Connection, wallet?: AnchorWallet | null): SigapProgram {
  const provider = new AnchorProvider(connection, wallet ?? READONLY_WALLET, { commitment: "confirmed" });
  return new Program(IDL, provider);
}

// ----------------------------------------------------------------------------
// PDA
// ----------------------------------------------------------------------------
const enc = (s: string) => Buffer.from(s);
const pda = (seeds: (Buffer | Uint8Array)[]) => PublicKey.findProgramAddressSync(seeds, PROGRAM_ID)[0];

export const configPda = () => pda([enc("config")]);
export const memberPda = (wallet: PublicKey) => pda([enc("member"), wallet.toBuffer()]);
export const batchPda = (batchId: string) => pda([enc("batch"), enc(batchId)]);
export const tempLogPda = (batch: PublicKey) => pda([enc("templog"), batch.toBuffer()]);
export const deliveryPda = (batch: PublicKey, school: PublicKey) => pda([enc("delivery"), batch.toBuffer(), school.toBuffer()]);
export const recallPda = (batch: PublicKey) => pda([enc("recall"), batch.toBuffer()]);
export const incidentPda = (batch: PublicKey, index: number) => {
  const b = Buffer.alloc(4);
  b.writeUInt32LE(index);
  return pda([enc("incident"), batch.toBuffer(), b]);
};

// ----------------------------------------------------------------------------
// Utilitas
// ----------------------------------------------------------------------------
export const toNum = (v: BN | number | bigint | null | undefined) =>
  v == null ? 0 : typeof v === "number" ? v : typeof v === "bigint" ? Number(v) : v.toNumber();

export const nowSec = () => Math.floor(Date.now() / 1000);

/** Nama varian enum Anchor ({ diproduksi: {} } → "diproduksi") */
export const enumKey = (e: unknown) => (e && typeof e === "object" ? Object.keys(e)[0] : String(e));

export function fmtTime(sec: number) {
  if (!sec) return "—";
  return new Date(sec * 1000).toLocaleString("id-ID", { dateStyle: "medium", timeStyle: "short" });
}
export function fmtDuration(sec: number) {
  const m = Math.round(sec / 60);
  if (m < 60) return `${m} menit`;
  return `${Math.floor(m / 60)} jam ${m % 60} menit`;
}
export const fmtTemp = (x10: number) => `${(x10 / 10).toFixed(1)}°C`;
export const short = (k: PublicKey | string, n = 4) => {
  const s = k.toString();
  return `${s.slice(0, n)}…${s.slice(-n)}`;
};
export const explorerAccount = (k: PublicKey | string) =>
  `https://explorer.solana.com/address/${k.toString()}?cluster=${CLUSTER}`;
export const explorerTx = (sig: string) => `https://explorer.solana.com/tx/${sig}?cluster=${CLUSTER}`;

export async function sha256(data: Uint8Array | ArrayBuffer): Promise<Uint8Array> {
  const buf = data instanceof Uint8Array ? data : new Uint8Array(data);
  return new Uint8Array(await crypto.subtle.digest("SHA-256", buf as BufferSource));
}
export async function sha256File(file: File) {
  return sha256(await file.arrayBuffer());
}
export async function sha256Text(text: string) {
  return sha256(new TextEncoder().encode(text));
}
export const toHex = (b: Uint8Array | number[]) => Buffer.from(b).toString("hex");
export const isZeroHash = (b: number[] | Uint8Array) => Array.from(b).every((x) => x === 0);

export function toDatetimeLocal(sec: number) {
  const d = new Date(sec * 1000);
  const off = d.getTimezoneOffset() * 60000;
  return new Date(d.getTime() - off).toISOString().slice(0, 16);
}
export const fromDatetimeLocal = (v: string) => Math.floor(new Date(v).getTime() / 1000);

/** Ambil batch_id dari isi QR (URL /cek/<id> atau id mentah). */
export function parseBatchQr(text: string) {
  const t = text.trim();
  const m = t.match(/\/cek\/([^/?#]+)/);
  return decodeURIComponent(m ? m[1] : t);
}

export function errMsg(e: unknown): string {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const any = e as any;
  if (any?.error?.errorMessage) return any.error.errorMessage;
  if (any?.logs) {
    const l = (any.logs as string[]).find((x) => x.includes("Error Message:"));
    if (l) return l.split("Error Message:")[1].trim();
  }
  const msg = any?.message ?? String(e);
  if (msg.includes("already in use")) return "Akun sudah ada (ID batch sudah dipakai?)";
  if (msg.includes("AccountNotInitialized") || msg.includes("Account does not exist"))
    return "Akun belum terdaftar on-chain (cek peran wallet / data batch)";
  return msg;
}

// ----------------------------------------------------------------------------
// Rantai hash suhu (harus identik dengan hashv di program)
// ----------------------------------------------------------------------------
export type Reading = { ts: number; tempX10: number };

export function orderedReadings(log: { head: number; readings: { ts: BN; tempX10: number }[] }): Reading[] {
  const r = log.readings.map((x) => ({ ts: toNum(x.ts), tempX10: x.tempX10 }));
  if (r.length < 48) return r;
  return [...r.slice(log.head), ...r.slice(0, log.head)];
}

export async function computeTempChain(readings: Reading[]): Promise<string> {
  let h = new Uint8Array(32);
  for (const r of readings) {
    const buf = Buffer.alloc(32 + 8 + 2);
    Buffer.from(h).copy(buf, 0);
    buf.writeBigInt64LE(BigInt(r.ts), 32);
    buf.writeInt16LE(r.tempX10, 40);
    h = new Uint8Array(await sha256(buf));
  }
  return toHex(h);
}

export { BN };
