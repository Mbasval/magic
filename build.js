import { cp, mkdir, rm } from "node:fs/promises";
import { existsSync } from "node:fs";

await rm("public", { recursive: true, force: true });
await mkdir("public/src", { recursive: true });

await cp("index.html", "public/index.html");
await cp("styles.css", "public/styles.css");
await cp("src/main.js", "public/src/main.js");
if (existsSync("magnific-litang.mp3")) {
  await cp("magnific-litang.mp3", "public/magnific-litang.mp3");
}

console.log("Built static site into public/");
