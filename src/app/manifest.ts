import type { MetadataRoute } from "next";

// Admin-Backend als installierbare Web-App. Der Scanner bekommt in Phase 4 ein eigenes Manifest.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Guestlist Admin",
    short_name: "Admin",
    start_url: "/admin",
    scope: "/",
    display: "standalone",
    background_color: "#07070a",
    theme_color: "#07070a",
    icons: [{ src: "/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" }],
  };
}
