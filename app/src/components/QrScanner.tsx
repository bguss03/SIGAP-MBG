"use client";

import { useEffect, useRef, useState } from "react";

/* eslint-disable @typescript-eslint/no-explicit-any */

export default function QrScanner({ onResult }: { onResult: (text: string) => void }) {
  const [on, setOn] = useState(false);
  const [err, setErr] = useState("");
  const ref = useRef<any>(null);

  useEffect(() => {
    if (!on) return;
    let stopped = false;
    (async () => {
      const { Html5Qrcode } = await import("html5-qrcode");
      if (stopped) return;
      const s = new Html5Qrcode("qr-reader");
      ref.current = s;
      try {
        await s.start(
          { facingMode: "environment" },
          { fps: 10, qrbox: 220 },
          (text: string) => {
            onResult(text);
            setOn(false);
          },
          () => {},
        );
      } catch (e) {
        setErr("Kamera tidak dapat dibuka: " + (e as Error).message);
        setOn(false);
      }
    })();
    return () => {
      stopped = true;
      const s = ref.current;
      if (s) s.stop().then(() => s.clear()).catch(() => {});
      ref.current = null;
    };
  }, [on, onResult]);

  return (
    <div>
      <button className="btn btn-blue" onClick={() => setOn(!on)}>{on ? "Tutup kamera" : "📷 Scan QR"}</button>
      {on && <div id="qr-reader" style={{ marginTop: 10 }} />}
      {err && <div className="alert alert-err">{err}</div>}
    </div>
  );
}

