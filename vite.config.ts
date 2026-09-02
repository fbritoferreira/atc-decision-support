import { defineConfig } from "vite";
import { devtools } from "@tanstack/devtools-vite";
import { AIRPORTS } from "./src/sim/airports";

import { tanstackStart } from "@tanstack/react-start/plugin/vite";

import viteReact from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

const config = defineConfig({
  resolve: { tsconfigPaths: true },
  plugins: [
    devtools(),
    tailwindcss(),
    tanstackStart({
      spa: { enabled: true },
      // Without this every URL served the same shell: one title, no
      // description, no canonical, identical HTML for five distinct pages.
      // Prerendering gives each route real HTML with its own head.
      prerender: { enabled: true, crawlLinks: true, failOnError: false },
      sitemap: { enabled: true, host: "https://atc.fbritoferreira.com" },
      pages: [
        { path: "/", prerender: { enabled: true } },
        { path: "/about", prerender: { enabled: true } },
        { path: "/squawks", prerender: { enabled: true } },
        { path: "/live", prerender: { enabled: true } },
        ...Object.keys(AIRPORTS).map((icao) => ({
          path: `/live/${icao}`,
          prerender: { enabled: true },
        })),
      ],
    }),
    viteReact(),
  ],
  server: {
    proxy: {
      "/api/adsb": {
        target: "https://api.adsb.lol",
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/adsb/, ""),
      },
      "/api/wx": {
        target: "https://aviationweather.gov",
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/wx/, "/api"),
      },
    },
  },
});

export default config;
