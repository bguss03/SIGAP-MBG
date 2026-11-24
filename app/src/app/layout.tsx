import type { Metadata } from "next";
import Providers from "@/components/Providers";
import { Header } from "@/components/ui";
import "./globals.css";

export const metadata: Metadata = {
  title: "SIGAP-MBG · Ketertelusuran Keamanan Pangan MBG di Solana",
  description:
    "Blockchain + IoT untuk ketertelusuran keamanan pangan per-batch pada Program Makan Bergizi Gratis (MBG), berjalan di Solana.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="id">
      <body>
        <Providers>
          <Header />
          <main className="container main">{children}</main>
          <footer className="footer container">
            SIGAP-MBG · Tugas Mata Kuliah Blockchain · Universitas Semarang · Data tersimpan di Solana (program Anchor)
          </footer>
        </Providers>
      </body>
    </html>
  );
}
