// Checks that every piece of JavaScript in the site at least compiles:
// the inline <script> blocks of the HTML pages and the separate .js files.
// A syntax error anywhere would otherwise only show up in a visitor's browser.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import vm from "node:vm";

const publicDir = new URL("../../public/", import.meta.url);
let checked = 0;
const failures = [];

const compile = (code, name, asModule) => {
  try {
    if (asModule) {
      new vm.SourceTextModule(code, { identifier: name });
    } else {
      new vm.Script(code, { filename: name });
    }
    checked += 1;
  } catch (error) {
    failures.push(`${name}: ${error.message}`);
  }
};

const walk = (dir) => readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
  entry.isDirectory() ? walk(new URL(`${entry.name}/`, dir)) : [new URL(entry.name, dir)]);

for (const file of walk(publicDir)) {
  const name = file.pathname.split("/public/")[1];
  const text = readFileSync(file, "utf8");
  if (name.endsWith(".html")) {
    const scripts = [...text.matchAll(/<script(\s[^>]*)?>([\s\S]*?)<\/script>/g)];
    scripts.forEach(([, attributes = "", code], index) => {
      if (/\bsrc=/.test(attributes) || !code.trim()) return;
      compile(code, `${name} <script> #${index + 1}`, /type=["']module["']/.test(attributes));
    });
  } else if (name.endsWith(".js")) {
    // Files under public/js/ are ES modules; others (sw.js) are scripts.
    compile(text, name, name.startsWith("js/"));
  } else if (name.endsWith(".webmanifest") || name.endsWith(".json")) {
    try {
      JSON.parse(text);
      checked += 1;
    } catch (error) {
      failures.push(`${name}: ${error.message}`);
    }
  }
}

if (failures.length) {
  console.error(failures.join("\n"));
  process.exit(1);
}
console.log(`Syntax OK: ${checked} scripts and files compiled.`);
