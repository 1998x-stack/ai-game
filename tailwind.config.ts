import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        panel: {
          'bg-deep': '#0a0a1a',
          bg: '#1a1a2e',
          surface: '#16213e',
          border: '#0f3460',
          accent: '#e94560',
          'accent-hover': '#d63850',
          text: '#eaeaea',
          muted: '#8888aa',
          'muted-hover': '#aaaacc',
        },
      },
    },
  },
  plugins: [],
};

export default config;
