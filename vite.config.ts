import path from "path";
import { defineConfig, loadEnv } from "vite";

import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import openrouter from "./server/openrouter";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, __dirname, "");
  const openrouterKey = env.OPENROUTER_API_KEY;

  return {
    plugins: [react(), tailwindcss(), openrouter({ apiKey: openrouterKey })],
    resolve: {
      alias: {
        "@": path.resolve(__dirname, "./src"),
      },
    },
  };
});
