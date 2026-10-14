// Configures workspace compilation and prevents cached delivery of journal photos.
import type { NextConfig } from "next";
import path from "node:path";

const nextConfig: NextConfig = {
  transpilePackages: ["@bright/shared", "@bright/backend"],
  serverExternalPackages: ["sharp"],
  turbopack: { root: path.resolve(__dirname, "..") },
  images: { localPatterns: [{ pathname: "/assets/**", search: "" }] },
  /** Returns consistent browser security headers without caching private content. */
  async headers() {
    return [{ source: "/:path*", headers: [
      { key: "X-Content-Type-Options", value: "nosniff" },
      { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
      { key: "X-Frame-Options", value: "DENY" },
      { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
      { key: "X-Robots-Tag", value: "noindex, nofollow, noarchive" },
      { key: "Content-Security-Policy", value: "frame-ancestors 'none'; object-src 'none'; base-uri 'self'; form-action 'self'" },
    ] }];
  },
};
export default nextConfig;
