import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const pagesRoot = path.resolve(process.env.PAGES_REPO ?? path.join(root, "../patrickread.github.io"));
const dest = path.join(pagesRoot, "spelling-quiz");
const indexPath = path.join(pagesRoot, "index.html");

if (!fs.existsSync(indexPath)) {
  console.error(`Could not find the GitHub Pages repo at ${pagesRoot}.`);
  console.error("Set PAGES_REPO to the checkout of patrickread.github.io.");
  process.exit(1);
}

const build = spawnSync("npm", ["run", "build"], { cwd: root, stdio: "inherit" });
if (build.status !== 0) process.exit(build.status ?? 1);

fs.rmSync(dest, { recursive: true, force: true });
fs.cpSync(path.join(root, "dist"), dest, { recursive: true });

const marker = 'href="spelling-quiz/index.html"';
const index = fs.readFileSync(indexPath, "utf8");
if (!index.includes(marker)) {
  const link = `            <a href="spelling-quiz/index.html" style="display: block; width: 200px;">
                <div style="background-color: #f0f0f0; padding: 10px; border-radius: 5px; width: 100%; text-align: center;">
                    Spelling Quiz
                </div>
            </a>
`;
  const closing = "        </div>";
  const at = index.lastIndexOf(closing);
  if (at === -1) {
    console.error("Could not find the games list in the Pages index.html.");
    process.exit(1);
  }
  fs.writeFileSync(indexPath, `${index.slice(0, at)}${link}${index.slice(at)}`);
  console.log("Added a Spelling Quiz link to the games page.");
}

console.log(`Copied the built quiz to ${dest}.`);
