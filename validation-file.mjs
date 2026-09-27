import { readdirSync } from "node:fs";

/** 取得根目錄唯一的現行驗證報告；不得在守門裡寫死上一版檔名。 */
export function validationFileName(directory) {
  const matches = readdirSync(directory).filter((name) =>
    /^VALIDATION_v[\d.]+\.md$/.test(name),
  );
  if (matches.length !== 1)
    throw new Error(`根目錄應只有一份 VALIDATION_v*.md，實際為：${matches.join("、") || "（無）"}`);
  return matches[0];
}
