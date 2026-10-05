import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const target = join(root, "manual-title.test.mjs");
const oldPDF = process.argv[2];
const pdfinfo = execFileSync("pdfinfo", [join(root, "manuals", "交通服務水準程式手冊_v2.20.82.pdf")], { encoding: "utf8" });
const wrongInfo = pdfinfo.replace(/^(Title:\s+.*)v2\.20\.82/m, "$1v2.20.79");
assert.notEqual(wrongInfo, pdfinfo, "precondition: title is present");
const cases = [
  ["normal", 0, 3, 0, 0],
  ["html-old", 1, 2, 1, 0],
  ["pdf-old", 1, 2, 1, 0],
  ["version-missing", 1, 0, 3, 0],
  ["manual-missing", 1, 2, 1, 0],
  ["pdfinfo-missing", 0, 2, 0, 1],
  ["pdfinfo-failed", 1, 2, 1, 0],
];
for (const [mode, exit, pass, fail, skipped] of cases) {
  const driver = `
    import fs from "node:fs";
    import cp from "node:child_process";
    import { syncBuiltinESMExports } from "node:module";
    import { pathToFileURL } from "node:url";
    const mode = ${JSON.stringify(mode)};
    const originalRead = fs.readFileSync;
    const originalExists = fs.existsSync;
    const originalExec = cp.execFileSync;
    fs.readFileSync = function(path, ...args) {
      const value = originalRead.call(this, path, ...args);
      const name = String(path).replaceAll("\\\\", "/");
      if (mode === "html-old" && name.endsWith("/manual-src/manual.html"))
        return value.replace(/(<title>[^<]*)v2\\.20\\.82/, "$1v2.20.79");
      if (mode === "version-missing" && name.endsWith("/app.js"))
        return value.replace(/正式版\\s*v[\\d.]+/g, "BROKEN VERSION");
      return value;
    };
    fs.existsSync = function(path) {
      if (mode === "manual-missing" && String(path).replaceAll("\\\\", "/").endsWith("/manual-src/manual.html")) return false;
      return originalExists.call(this, path);
    };
    cp.execFileSync = function(command, ...args) {
      if (command === "pdfinfo") {
        if (mode === "pdf-old") return ${JSON.stringify(oldPDF)} ? originalExec.call(this, command, [${JSON.stringify(oldPDF)}], {encoding:"utf8"}) : ${JSON.stringify(wrongInfo)};
        if (mode === "pdfinfo-missing") throw Object.assign(new Error("injected missing tool"), {code:"ENOENT"});
        if (mode === "pdfinfo-failed") throw Object.assign(new Error("injected parse failure"), {status:2,code:"EIO"});
      }
      return originalExec.call(this, command, ...args);
    };
    syncBuiltinESMExports();
    await import(pathToFileURL(${JSON.stringify(target)}).href);
  `;
  const result = spawnSync(process.execPath, ["--input-type=module", "-e", driver], { encoding:"utf8", cwd:root });
  const output = result.stdout + result.stderr;
  assert.equal(result.status, exit, mode + "\n" + output);
  const count = key => Number(output.match(new RegExp("\\b" + key + "\\s+(\\d+)"))?.[1]);
  assert.equal(count("pass"), pass, mode + output);
  assert.equal(count("fail"), fail, mode + output);
  assert.equal(count("skipped"), skipped, mode + output);
  if (mode === "pdfinfo-missing") assert.match(output, /這台機器沒有 pdfinfo/);
  console.log("PASS: " + mode + " exit=" + exit + " pass=" + pass + " fail=" + fail + " skip=" + skipped);
}
console.log("PASS: actual manual-title tests independently reject old HTML/PDF, broken version/missing source; missing tool skips explicitly, parse failure is not skipped. No files were mutated.");
