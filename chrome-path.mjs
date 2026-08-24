/*
 * 找出這台電腦上可以用的 Chromium。
 *
 * 為什麼需要這一支：所有端對端腳本與手冊 PDF 產生器原本都寫死
 * `/opt/pw-browsers/chromium-1194/chrome-linux/chrome`——那是**開發容器裡的
 * 路徑**。交付包換到另一台電腦時那個檔案不存在，腳本會直接丟錯，
 * 而備份包的意義就是要能在別台電腦完整重建與驗證。
 *
 * 現在的順序是：
 *  1. 環境變數 CHROME_PATH（要用特定的瀏覽器時可以指定）
 *  2. 開發容器的固定路徑（存在才用）
 *  3. 交給 Playwright 自己找它安裝的瀏覽器（回傳 undefined 即可，
 *     Playwright 會用 `npx playwright install` 裝下來的那一份）
 */
import { existsSync } from "node:fs";

const CONTAINER_CHROME = "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";

export function chromePath() {
  const fromEnv = process.env.CHROME_PATH;
  if (fromEnv && existsSync(fromEnv)) return fromEnv;
  if (existsSync(CONTAINER_CHROME)) return CONTAINER_CHROME;
  return undefined;
}

/**
 * 直接展開成 chromium.launch() 的參數。
 * executablePath 是 undefined 時 Playwright 會用自己安裝的瀏覽器，
 * 所以這裡刻意不放這個鍵，而不是放一個 undefined。
 */
export function launchOptions(extra = {}) {
  const executablePath = chromePath();
  return {
    args: ["--no-sandbox"],
    ...(executablePath ? { executablePath } : {}),
    ...extra,
  };
}
