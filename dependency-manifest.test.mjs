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
import { createHash } from "node:crypto";
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
  for (const file of [
    "e2e-speed.mjs",
    "e2e-conclusion.mjs",
    "e2e-layout.mjs",
    "e2e-year-style.mjs",
  ]) {
    const source = await readFile(new URL(file, root), "utf8");
    assert.doesNotMatch(source, /speed-samples/, `${file} 仍依賴交付包外部資料夾`);
    assert.doesNotMatch(source, /join\(here,\s*["']\.\.["']/, `${file} 的測資路徑仍指向專案外部`);
  }
});

test("所有測試與腳本都不得 import 專案外的相對路徑", async () => {
  const offenders = [];
  const patterns = [
    /\bfrom\s+["']([^"']+)["']/g,
    /\bimport\s+["']([^"']+)["']/g,
    /\brequire\(\s*["']([^"']+)["']\s*\)/g,
    /\bimport\(\s*["']([^"']+)["']\s*\)/g,
  ];
  for (const file of await sourceFiles()) {
    const source = await readFile(new URL(file, root), "utf8");
    for (const pattern of patterns)
      for (const match of source.matchAll(pattern)) {
        if (!match[1].startsWith(".")) continue;
        const target = new URL(match[1], new URL(file, root));
        if (!target.href.startsWith(root.href)) offenders.push(`${file} → ${match[1]}`);
      }
  }
  assert.deepEqual(
    offenders,
    [],
    "交付包引用了專案外檔案，換一台電腦或獨立解壓後會失敗",
  );
});

test("交付包不可再帶入已過時的 GPT Site 交接說明", async () => {
  await assert.rejects(
    access(new URL("給Claude的交接說明_v2.20.1.md", root)),
    "舊交接說明仍宣稱 GPT Site 維持原網址，會誤導後續維護",
  );
});

test("瀏覽器與測試端使用同一版 SheetJS 0.20.3", async () => {
  const pkg = JSON.parse(await readFile(new URL("package.json", root), "utf8"));
  assert.equal(pkg.devDependencies.xlsx, "file:./vendor/xlsx-0.20.3.tgz");
  const vendor = await readFile(new URL("vendor/xlsx.full.min.js", root), "utf8");
  assert.match(vendor, /0\.20\.3/, "瀏覽器端 SheetJS 不是 0.20.3");
  const tgz = await readFile(new URL("vendor/xlsx-0.20.3.tgz", root));
  assert.equal(
    createHash("sha256").update(tgz).digest("hex").toUpperCase(),
    "8DC73FC3B00203E72D176E85B50938627C7B086E607C682E8D3C22C02BB99FE8",
    "內附的 SheetJS 0.20.3 安裝包不是已核對的官方檔案",
  );
});

/*
 * 方向顯示名稱：不准再有「直接把鍵值印給人看」的地方（v2.20.6）。
 *
 * 這是原始碼層級的守門檢查，補端對端測不到的角落（例如健康檢查的問題說明，
 * 要湊出資料異常才會出現）。判斷方式是：只要一段字串是要寫給人看的
 * ——HTML 的 <td>、健康檢查的 item、CSV 欄位——裡面就不可以出現裸的
 * `.direction`，必須先過 directionName／rowDirectionName／managerDirectionName。
 *
 * 鍵值本身的用途（組 id、組速限 key、分組、篩選）不在此限，那些不是給人看的。
 */
test("要顯示給人看的方向一律走顯示名稱解析，不直接印鍵值", async () => {
  const offenders = [];
  for (const file of ["app.js", "quality-extension.js"]) {
    const source = await readFile(new URL(file, root), "utf8");
    source.split("\n").forEach((line, index) => {
      /* 只看「這一行同時是輸出字串」的情況。 */
      const rendersToUser =
        /<t[dh]>/.test(line) || /\bitem:\s*`/.test(line) || /安全|說明|草稿/.test(line);
      if (!rendersToUser) return;
      if (/\$\{(?:esc\()?\s*(?:x|d|row|r)\.direction\s*[,)}]/.test(line))
        offenders.push(`${file}:${index + 1}：${line.trim().slice(0, 110)}`);
    });
  }
  assert.deepEqual(
    offenders,
    [],
    "以下位置直接把方向鍵值印給使用者看：\n" + offenders.join("\n"),
  );
});

test("方向的用詞全站統一為「方向1／方向2」，不再混用「方向A／方向B」", async () => {
  const offenders = [];
  for (const file of ["app.js", "index.html", "quality-extension.js", "conclusion.js"]) {
    const source = await readFile(new URL(file, root), "utf8");
    source.split("\n").forEach((line, index) => {
      /* directionA／directionB 是儲存欄位名，不能改（改了舊備份還原不回來）；
         這裡擋的是寫給人看的中文字樣。 */
      const text = line.replace(/direction[AB]/g, "");
      if (/方向[AB]/.test(text))
        offenders.push(`${file}:${index + 1}：${line.trim().slice(0, 110)}`);
    });
  }
  assert.deepEqual(
    offenders,
    [],
    "以下位置還在用「方向A／方向B」的說法：\n" + offenders.join("\n"),
  );
});

test("directionName 是唯一的方向顯示名稱來源，且鍵值不會被改寫", async () => {
  const source = await readFile(new URL("app.js", root), "utf8");
  assert.match(source, /function directionNameFrom\(meta, direction\)/);
  assert.match(source, /function directionName\(road, direction/);
  assert.match(source, /function rowDirectionName\(row\)/);
  assert.match(source, /function managerDirectionName\(row\)/);
  /* 命名只寫進 roadMeta，永遠不可以去改明細的 direction 欄位。 */
  assert.doesNotMatch(source, /\.direction\s*=\s*(?!\w*Key)[^=]/);
});

test("Manager 匯入會把專案包裡的方向名稱一起接進來", async () => {
  const source = await readFile(new URL("app.js", root), "utf8");
  assert.match(source, /packageRoadMeta:\s*p\.roadMeta/);
  /* 組合包（一次多個計畫）原本整份丟掉 roadMeta。 */
  assert.match(source, /roadMeta:\s*Object\.fromEntries\(/);
});

test("有 .gitattributes 且關閉換行轉換", async () => {
  /*
   * 在 Windows 上取出時 Git 預設會把文字檔轉成 CRLF。姊妹系統實測過後果：
   * 備份 ZIP 裡每個文字檔都變 CRLF，檔案內容不再等於它自己的雜湊檔名，
   * 而網站照樣跑得動，完全看不出來。本專案的交付包實測也有 19 個 CRLF 檔。
   */
  const text = await readFile(new URL(".gitattributes", root), "utf8");
  assert.match(text, /^\*\s+-text\s*$/m, ".gitattributes 必須包含 `* -text`");
});

test("交付的原始碼裡沒有 CRLF", async () => {
  const offenders = [];
  for (const file of [
    "app.js",
    "conclusion.js",
    "quality-extension.js",
    "excel-export.js",
    "index.html",
    "package.json",
  ]) {
    const text = await readFile(new URL(file, root), "utf8");
    if (text.includes("\r\n")) offenders.push(file);
  }
  assert.deepEqual(offenders, [], "以下檔案含 CRLF：" + offenders.join("、"));
});
