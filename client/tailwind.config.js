/** Tailwind is compiled at build time (previously the cdn.tailwindcss.com
 *  script compiled it in the browser on every page load). */
/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: { extend: {} },
  plugins: [],
};
