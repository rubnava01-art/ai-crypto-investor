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
          // P2 (2026-11-23): HSTS + CSP en modo report-only (medir, no
          // endurecer): la CSP restrictiva rompería scripts en línea del
          // runtime de Next, así que solo se reporta; HSTS sí se aplica.
          { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
          {
            key: "Content-Security-Policy-Report-Only",
            value:
              "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self' https://crypto-investor-api.onrender.com http://localhost:8000; media-src 'self'; frame-ancestors 'none'",
          },
        ],
      },
    ];
  },
};
export default nextConfig;
