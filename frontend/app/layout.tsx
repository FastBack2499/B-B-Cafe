import type { Metadata, Viewport } from "next";
import "@fontsource-variable/vazirmatn";
import "./globals.css";
import { Pwa } from "@/components/pwa";

export const metadata: Metadata = {
  title: { default: "نان و کره | منوی کافه", template: "%s | نان و کره" },
  description: "منوی کافه نان و کره",
  applicationName: "نان و کره",
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, statusBarStyle: "default", title: "نان و کره" },
  icons: { icon: "/icon-192.png", apple: "/icon-192.png" },
};
export const viewport: Viewport = { themeColor: "#213e33" };

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="fa" dir="rtl"><body>{children}<Pwa /></body></html>;
}
