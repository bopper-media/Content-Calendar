import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath } from "node:url";

const src = fileURLToPath(new URL("./src", import.meta.url));

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: [
      // The views were written for Next.js; this one Next import is shimmed.
      { find: /^next\/dynamic$/, replacement: `${src}/shims/next-dynamic.tsx` },
      { find: /^@\//, replacement: `${src}/` },
    ],
  },
});
