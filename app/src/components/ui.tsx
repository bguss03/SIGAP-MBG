"use client";

import Link from "next/link";
import dynamic from "next/dynamic";
import { usePathname } from "next/navigation";
import { ReactNode } from "react";
import { explorerTx, FLAGS, enumKey, roleNames, ROLE_LABEL, CLUSTER } from "@/lib/sigap";
import { useSigap } from "@/lib/hooks";

const WalletMultiButton = dynamic(
  async () => (await import("@solana/wallet-adapter-react-ui")).WalletMultiButton,
  { ssr: false },
);

const NAV = [
  { href: "/", label: "Dashboard" },
  { href: "/sppg", label: "SPPG" },
  { href: "/sekolah", label: "Sekolah" },
  { href: "/dinkes", label: "Dinkes" },
  { href: "/bpom", label: "BPOM" },
  { href: "/cek", label: "Cek Publik" },
  { href: "/admin", label: "Admin" },
];

export function Header() {
  const path = usePathname();
  const { member, isAdmin } = useSigap();
  return (
    <header className="header">
      <div className="container header-inner">
        <Link href="/" className="brand">
          <span className="logo">S</span>
          <span>
            <b>SIGAP-MBG</b>
            <small>Ketertelusuran pangan · Solana {CLUSTER}</small>
          </span>
        </Link>
        <nav className="nav">
          {NAV.map((n) => (
            <Link key={n.href} href={n.href} className={path === n.href || (n.href !== "/" && path.startsWith(n.href)) ? "active" : ""}>
              {n.label}
            </Link>
          ))}
        </nav>
        <div className="wallet-area">
          {(member || isAdmin) && (
            <div className="roles">
              {isAdmin && <span className="chip chip-dark">Admin</span>}
              {member && roleNames(member.roles).map((r) => <span key={r} className="chip">{ROLE_LABEL[r]}</span>)}
            </div>
          )}
          <WalletMultiButton />
        </div>
      </div>
    </header>
  );
}

export function Card({ title, children, actions }: { title?: ReactNode; children: ReactNode; actions?: ReactNode }) {
  return (
    <section className="card">
      {(title || actions) && (
        <div className="card-head">
          {title && <h3>{title}</h3>}
          {actions}
        </div>
      )}
      {children}
    </section>
  );
}

export function TxMessage({ msg }: { msg: { kind: string; text: string; sig?: string } | null }) {
  if (!msg) return null;
  return (
    <div className={`alert alert-${msg.kind}`}>
      {msg.text}
      {msg.sig && (
        <>
          {" · "}
          <a href={explorerTx(msg.sig)} target="_blank" rel="noreferrer">
            lihat transaksi ↗
          </a>
        </>
      )}
    </div>
  );
}

const STATUS_LABEL: Record<string, string> = {
  diproduksi: "DIPRODUKSI",
  dikirim: "DIKIRIM",
  peringatan: "PERINGATAN",
  dibekukan: "DIBEKUKAN",
  ditarik: "DITARIK",
  dibebaskan: "AMAN (LAB)",
};

export function StatusBadge({ status, big }: { status: unknown; big?: boolean }) {
  const k = enumKey(status);
  return <span className={`badge badge-${k} ${big ? "badge-big" : ""}`}>{STATUS_LABEL[k] ?? k}</span>;
}

export function FlagChips({ flags }: { flags: number }) {
  return (
    <span className="flags">
      {flags & FLAGS.TIME_EXCEEDED ? <span className="chip chip-warn">⏱ Lewat batas waktu</span> : null}
      {flags & FLAGS.TEMP_DANGER ? <span className="chip chip-warn">🌡 Zona bahaya suhu</span> : null}
      {flags & FLAGS.INCIDENT ? <span className="chip chip-danger">⚠ Ada laporan insiden</span> : null}
    </span>
  );
}

export function NeedWallet({ children }: { children?: ReactNode }) {
  return (
    <div className="empty">
      <p>{children ?? "Hubungkan wallet Solana (mis. Phantom, jaringan Devnet) untuk melanjutkan."}</p>
      <WalletMultiButton />
    </div>
  );
}

export function RoleGate({ role, label, children }: { role: number; label: string; children: ReactNode }) {
  const { wallet, hasRole, loading, config } = useSigap();
  if (!wallet) return <NeedWallet />;
  if (loading) return <div className="empty">Memuat data on-chain…</div>;
  if (!config)
    return (
      <div className="empty">
        Program belum diinisialisasi. Buka <Link href="/admin">halaman Admin</Link>.
      </div>
    );
  if (!hasRole(role))
    return (
      <div className="empty">
        Wallet <code>{wallet.publicKey.toBase58()}</code> belum memiliki peran <b>{label}</b>.
        <br />
        Minta admin (BGN) mendaftarkannya di <Link href="/admin">halaman Admin</Link>.
      </div>
    );
  return <>{children}</>;
}

export function enumIs(e: unknown, k: string) {
  return enumKey(e) === k;
}
