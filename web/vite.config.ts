import { defineConfig } from "vite";

// Relative base so the built assets resolve correctly whether the app is
// served from a GitHub Pages project path (e.g. /AH-bonnetjes-inzicht/) or
// any other subpath.
export default defineConfig({
  base: "./",
  build: {
    rolldownOptions: {
      output: {
        // tesseract.js laadt taaldata als "<langPath>/<taal>.traineddata.gz" —
        // dat bestand moet dus zijn eigen naam houden (zie lidlOcrParser.ts).
        assetFileNames: (asset) =>
          asset.names.some((n) => n.endsWith(".traineddata.gz"))
            ? "assets/tesseract/[name][extname]"
            : "assets/[name]-[hash][extname]",
      },
    },
  },
});
