// pdf.js のワーカーを public/ に置き、ブラウザから /pdf.worker.min.mjs で読めるようにする
import { copyFileSync, mkdirSync } from "node:fs";

mkdirSync("public", { recursive: true });
copyFileSync("node_modules/pdfjs-dist/build/pdf.worker.min.mjs", "public/pdf.worker.min.mjs");
