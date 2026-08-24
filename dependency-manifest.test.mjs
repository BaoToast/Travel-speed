/*
 * 交付包要能在另一台電腦完整重建與驗證。
 *
 * 起因：外部檢查把原始碼包解壓到乾淨環境後，`npm test` 有 3 項失敗，
 * 而且端對端腳本與手冊產生器用到的套件根本沒有列進依賴——在這台機器上
 * 「剛好裝了」所以看不出來，換一台電腦就跑不起來。
 *
 * 這一支把兩件事釘住：
 *  1. tests/ 與 scripts/ 實際 import 的每一個外部套件，都必須列在
 *     package.json 的 dependencies 或 devDependencies 裡。
 *  2. 會讀建置產物（dist/）的測試，其測試指令必須先建置。
 */
import assert from "node:assert/strict";
import test from "node:test";
import { access, readFile, readdir } from "node:fs/promises";

/* 交通服務水準是純靜態網站，測試與腳本就放在專案根目錄。 */
const root = new URL("./", import.meta.url);

async function sourceFiles() {
  const files = [];
  for (const dir of [".", "manual-src"]) {
    let entries = [];
    try {
      entries = await readdir(new URL(dir + "/", root));
    } catch {
      continue;
    }
    for (const entry of entries)
      if (/\.(mjs|ts|tsx)$/.test(entry)) files.push(`${dir}/${entry}`);
  }
  return files;
}

/** 從一份原始碼裡抓出所有「外部套件」的名稱（排除相對路徑與 node: 內建）。 */
function externalImports(source) {
  const names = new Set();
  const patterns = [
    /\bfrom\s+["']([^"']+)["']/g,
    /\bimport\s+["']([^"']+)["']/g,
    /\brequire\(\s*["']([^"']+)["']\s*\)/g,
    /\bimport\(\s*["']([^"']+)["']\s*\)/g,
  ];
  for (const pattern of patterns)
    for (const match of source.matchAll(pattern)) {
      const specifier = match[1];
      if (specifier.startsWith(".") || specifier.startsWith("/")) continue;
      if (specifier.startsWith("node:")) continue;
      /* @scope/name 取兩段，其餘取第一段 */
      const parts = specifier.split("/");
      names.add(specifier.startsWith("@") ? parts.slice(0, 2).join("/") : parts[0]);
    }
  return names;
}

test("測試與腳本 import 的每一個套件都列在 package.json 裡", async () => {
  const pkg = JSON.parse(await readFile(new URL("package.json", root), "utf8"));
  const declared = new Set([
    ...Object.keys(pkg.dependencies ?? {}),
    ...Object.keys(pkg.devDependencies ?? {}),
  ]);
  const missing = new Map();
  for (const file of await sourceFiles()) {
    const source = await readFile(new URL(file, root), "utf8");
    for (const name of externalImports(source))
      if (!declared.has(name))
        missing.set(name, [...(missing.get(name) ?? []), file]);
  }
  assert.deepEqual(
    [...missing.entries()].map(([name, files]) => `${name}（${files.join("、")}）`),
    [],
    "有套件沒有列進依賴，換一台電腦就裝不起來",
  );
});

test("會讀 dist/ 的測試，測試指令必須先建置", async () => {
  const pkg = JSON.parse(await readFile(new URL("package.json", root), "utf8"));
  let needsBuild = false;
  for (const file of await sourceFiles()) {
    if (!/\.test\.mjs$/.test(file)) continue;
    /* 跳過這一支自己——它的正規表示式裡就寫著 dist/，會自我命中。 */
    if (file.endsWith("dependency-manifest.test.mjs")) continue;
    const source = await readFile(new URL(file, root), "utf8");
    if (/["'`][^"'`]*\bdist\//.test(source)) needsBuild = true;
  }
  if (!needsBuild) return;
  assert.match(
    pkg.scripts.test,
    /(^|&&\s*)npm run build\b/,
    "有測試會讀 dist/，但 npm test 沒有先建置——乾淨環境下會直接失敗",
  );
});

test("lock 檔和 package.json 宣告的依賴一致", async () => {
  const pkg = JSON.parse(await readFile(new URL("package.json", root), "utf8"));
  const lock = JSON.parse(await readFile(new URL("package-lock.json", root), "utf8"));
  const declared = [
    ...Object.keys(pkg.dependencies ?? {}),
    ...Object.keys(pkg.devDependencies ?? {}),
  ];
  const missing = declared.filter((name) => !lock.packages?.[`node_modules/${name}`]);
  assert.deepEqual(missing, [], "package-lock.json 沒有這些套件，npm ci 會失敗");
});

test("完整驗證會先建立匿名測資，而且不依賴交付包外部資料夾", async () => {
  const pkg = JSON.parse(await readFile(new URL("package.json", root), "utf8"));
  assert.match(pkg.scripts.e2e, /npm run fixtures/, "npm run e2e 必須先建立匿名測資");
  await access(new URL("generate-test-fixtures.mjs", root));
  for (const file of ["e2e-speed.mjs", "e2e-conclusion.mjs", "e2e-layout.mjs"]) {
    const source = await readFile(new URL(file, root), "utf8");
    assert.doesNotMatch(source, /speed-samples/, `${file} 仍依賴交付包外部資料夾`);
    assert.doesNotMatch(source, /join\(here,\s*["']\.\.["']/, `${file} 的測資路徑仍指向專案外部`);
  }
});

test("瀏覽器與測試端使用同一版 SheetJS 0.20.3", async () => {
  const pkg = JSON.parse(await readFile(new URL("package.json", root), "utf8"));
  assert.match(pkg.devDependencies.xlsx, /xlsx-0\.20\.3/, "測試端 SheetJS 不是 0.20.3");
  const vendor = await readFile(new URL("vendor/xlsx.full.min.js", root), "utf8");
  assert.match(vendor, /0\.20\.3/, "瀏覽器端 SheetJS 不是 0.20.3");
});
