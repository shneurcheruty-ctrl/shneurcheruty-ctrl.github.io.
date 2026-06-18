import { defineConfig, PluginOption } from "vite";
import { enterDevPlugin, enterProdPlugin } from "vite-plugin-enter-dev";
import path from "path";

export default defineConfig(({ mode }) => {
  const plugins = [...enterProdPlugin()];
  if (mode === "development") {
    plugins.push(...enterDevPlugin());
  }

  return {
    server: {
      host: "::",
      port: 8080,
      proxy: {
        "/zen": {
          target: "https://opencode.ai",
          changeOrigin: true,
        },
        "/a1111": {
          target: "http://127.0.0.1:7860",
          changeOrigin: false,
          rewrite: (p) => p.replace(/^\/a1111/, ""),
          configure: (proxy) => {
            proxy.on("error", (err) => console.error("[a1111 proxy err]", err));
          },
        },
      },
    },
    plugins: plugins.filter(Boolean) as PluginOption[],
    resolve: {
      alias: {
        "@": path.resolve(__dirname, "./src"),
      },
    },
    base: "/",
    build: {
      outDir: "dist",
    },
  };
});
