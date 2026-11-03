/** @type {import('next').NextConfig} */
const nextConfig = {
  // Fase 4 (FE11): headers mínimos. Caché larga solo para los MP3 de
  // meditación (contenido estable, servido con preload="none"); sin CSP
  // restrictiva: rompería scripts en línea del runtime de Next.
  async headers() {
    return [
      {
        source: "/sounds/:path*",
        headers: [{ key: "Cache-Control", value: "public, max-age=86400" }],
      },
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
        ],
      },
    ];
  },
};
export default nextConfig;
