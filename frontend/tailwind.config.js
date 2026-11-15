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
    },
  },
  plugins: [],
};
