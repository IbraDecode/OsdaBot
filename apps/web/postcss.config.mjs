/**
 * PostCSS untuk Tailwind CSS v4.
 * Tailwind v4 tidak lagi butuh `tailwind.config.js` — cukup plugin resmi
 * `@tailwindcss/postcss` dan `@import "tailwindcss"` di `globals.css`.
 */
const config = {
  plugins: {
    '@tailwindcss/postcss': {},
  },
};

export default config;
