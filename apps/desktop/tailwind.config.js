/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        'pixel-bg': '#0a0a0a',
        'pixel-primary': '#00ff88',
        'pixel-secondary': '#8800ff',
        'pixel-accent': '#ff0088',
      },
    },
  },
  plugins: [],
};
