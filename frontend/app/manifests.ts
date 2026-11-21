import type { MetadataRoute } from "next";

export function manifest(staffKey?: string): MetadataRoute.Manifest {
  const start = staffKey ? "/" + staffKey : "/";
  return {
    id: start, name: staffKey ? "پنل کافه نان و کره" : "کافه نان و کره",
    short_name: staffKey ? "پنل نان و کره" : "نان و کره", start_url: start, scope: start,
    lang: "fa", dir: "rtl", display: "standalone", background_color: "#f7f6f1", theme_color: "#213e33",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
