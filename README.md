# 交通服務水準分析系統－GitHub Pages 發布說明

## 發布步驟

1. 在 GitHub 建立新的儲存庫。
2. 將本資料夾內全部檔案上傳到儲存庫根目錄，包含 `.nojekyll`。
3. 進入儲存庫的 `Settings` → `Pages`。
4. 在 `Build and deployment` 選擇 `Deploy from a branch`。
5. Branch 選擇 `main`，資料夾選擇 `/ (root)`，再按 `Save`。
6. 等待 GitHub 完成發布後，按 `Visit site` 開啟正式網址。

## 重要資料說明

- 網站資料儲存在每台電腦自己的瀏覽器，不會上傳到 GitHub。
- 不同電腦需透過 Project 專案包匯出與匯入交換資料。
- 關閉瀏覽器不會清除資料，但清除網站資料、使用無痕模式、換瀏覽器或換網址會看不到原資料。
- 每完成一季應下載 Project 專案包備份。
- 請勿把原始調查 Excel、Project 專案包或其他正式資料上傳至公開 GitHub 儲存庫。

## 更新網站

日後取得新版網站檔案時，以新版 `index.html`、`styles.css`、`app.js`、`excel-export.js` 覆蓋儲存庫中的同名檔案即可。只要正式網址未改變，更新網頁通常不會清除瀏覽器中的既有資料。
