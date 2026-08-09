import { cloudflare } from "@cloudflare/vite-plugin";
import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv } from "vite";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  return {
    plugins: [react(), cloudflare({ remoteBindings: false })],
    server: { port: 5173 },
    build: { sourcemap: true },
    define: {
      "import.meta.env.VITE_TURNSTILE_SITE_KEY": JSON.stringify(env.TURNSTILE_SITE_KEY ?? ""),
      "import.meta.env.VITE_POSTHOG_KEY": JSON.stringify(env.POSTHOG_KEY ?? ""),
      "import.meta.env.VITE_POSTHOG_HOST": JSON.stringify(env.POSTHOG_HOST ?? ""),
      "import.meta.env.VITE_RELEASE": JSON.stringify(env.VITE_RELEASE ?? "0.1.0"),
    },
  };
});
