/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./app/**/*.{js,ts,jsx,tsx}", "./components/**/*.{js,ts,jsx,tsx}"],
  darkMode: "class",
  theme: {
    extend: {
      // F-1/F-6 (2026-11-14, Agente 2): font-sans = misma pila que
      // --font-sans en globals.css (Inter autoalojada + Jakarta),
      // para que `font-sans` y `body` no diverjan.
      fontFamily: {
        sans: [
          "var(--font-inter)",
          "var(--font-jakarta)",
          "ui-sans-serif",
          "system-ui",
          "-apple-system",
          '"Segoe UI"',
          "Roboto",
          '"Helvetica Neue"',
          "Arial",
          "sans-serif",
        ],
      },
      // 2026-11-22 (Agente UX): el sistema --fintech-* de globals.css,
      // espejado en el tema para que los componentes usen clases
      // `fintech-*` en vez de hardcodear zinc/slate/hex y no deriven.
      // Mismos valores que los tokens CSS; no cambia ningún estilo
      // existente por sí solo.
      colors: {
        fintech: {
          bg: "#030712",
          surface: "#0f172a",
          "surface-hover": "#1e293b",
          border: "#1e293b",
          emerald: "#10b981",
          "emerald-hover": "#34d399",
          "emerald-deep": "#047857",
          blue: "#3b82f6",
          "blue-hover": "#60a5fa",
          "blue-deep": "#2563eb",
          danger: "#ef4444",
          text: "#f9fafb",
          "text-muted": "#94a3b8",
        },
      },
      boxShadow: {
        "fintech-sm": "0 1px 2px rgb(0 0 0 / 0.4)",
        "fintech-md": "0 8px 24px rgb(0 0 0 / 0.45)",
        "fintech-lg": "0 20px 48px rgb(0 0 0 / 0.55)",
        "fintech-glow-blue":
          "0 0 0 1px rgb(59 130 246 / 0.25), 0 8px 32px rgb(59 130 246 / 0.18)",
        "fintech-glow-emerald":
          "0 0 0 1px rgb(16 185 129 / 0.25), 0 8px 32px rgb(16 185 129 / 0.18)",
      },
    },
  },
  plugins: [],
};
