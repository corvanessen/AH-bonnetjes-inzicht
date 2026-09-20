import { defineConfig } from "vite";

// Relative base so the built assets resolve correctly whether the app is
// served from a GitHub Pages project path (e.g. /AH-bonnetjes-inzicht/) or
// any other subpath.
export default defineConfig({
  base: "./",
});
