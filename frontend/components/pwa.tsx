"use client";

import { useEffect, useState } from "react";
import { Download } from "lucide-react";

interface InstallPrompt extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: string }>;
}
let pending: InstallPrompt | null = null;

export function Pwa() {
  useEffect(() => {
    if ("serviceWorker" in navigator && process.env.NODE_ENV === "production") {
      void navigator.serviceWorker.register("/sw.js").catch(() => undefined);
    }
    function store(event: Event) {
      event.preventDefault();
      pending = event as InstallPrompt;
    }
    window.addEventListener("beforeinstallprompt", store);
    return () => window.removeEventListener("beforeinstallprompt", store);
  }, []);
  return null;
}

export function InstallButton() {
  const [installed, setInstalled] = useState(false);
  const [help, setHelp] = useState(false);
  const [ios, setIos] = useState(false);
  useEffect(() => {
    const media = window.matchMedia("(display-mode: standalone)");
    setInstalled(media.matches || navigator.standalone === true);
    setIos(/iPhone|iPad|iPod/i.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1));
    const onInstall = () => setInstalled(true);
    window.addEventListener("appinstalled", onInstall);
    return () => window.removeEventListener("appinstalled", onInstall);
  }, []);
  if (installed) return null;
  async function install() {
    if (!pending) return setHelp((current) => !current);
    const prompt = pending;
    pending = null;
    await prompt.prompt();
    if ((await prompt.userChoice).outcome === "accepted") setInstalled(true);
  }
  return <div className="install-wrap">
    <button type="button" className="button soft install-button" aria-expanded={help} onClick={() => void install()}><Download size={17} /> نصب برنامه</button>
    {help && <div role="status" className="install-help">{ios
      ? "در سافاری، دکمهٔ اشتراک‌گذاری را بزنید و «افزودن به صفحهٔ اصلی» را انتخاب کنید."
      : "در منوی مرورگر گزینهٔ «نصب برنامه» یا «افزودن به صفحهٔ اصلی» را انتخاب کنید."}</div>}
  </div>;
}

declare global {
  interface Navigator { standalone?: boolean }
}
