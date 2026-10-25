# WaterUtilityReportTool(水務案件整理工具)

純前端工具(無後端、資料不離開瀏覽器):上傳 Excel 明細 → 排序/篩選/染色 → 產生報告文字 → 匯出圖片/PDF/Excel。
有「平常模式」與「災害模式」(`disasterMode`:廠所→行政區排序、依行政區染色、PDF 每廠所從新頁開始)。

## 先看這裡(省 token)
- **不要讀 `*.min.js` 與 `index_offline.html`**(第三方函式庫/產生物,體積巨大)。
- 找東西先跑 `node tools/symbols.js [關鍵字]`(列出各檔函式+行號),再只讀需要的檔案/行段。
- 全部原始碼約 2000 行 JS,分成 12 個小檔,每檔開頭有用途說明。

## 檔案地圖
| 檔案 | 內容 |
|---|---|
| `index.html` | 只有 HTML 結構與 `<script src>` 載入順序(**無邏輯**) |
| `css/app.css` | 全部樣式。`col.cA~cL` 欄寬為特調值 |
| `js/config.js` | 常數、`FIXED_UNITS`/`UNIT_SHORT`、配色 `PALETTE`/`DIST_PALETTE`、全域狀態 |
| `js/shared.js` | **三種輸出共用的單一來源**:`COLUMNS`、`SVC_STYLES`、`split4*`、`rowFill`、`orderUnits`、基礎函式 `e()`/`fmtTime` |
| `js/parse.js` | 上傳、`parse()`(表頭偵測、欄位對應) |
| `js/filter.js` | 篩選列、字級 |
| `js/actions.js` | `applyAll()`(排序+染色,依模式分流)、`resetRaw()`、`toggleDisaster()` |
| `js/report.js` | 時段篩選(含跨年)、業務課報告文字 |
| `js/summary.js` | 統計摘要(選填、預設收合,在業務課報告上方):`computeSummary`(純計算,Excel/PDF/看板共用;含 `trend` 每小時趨勢與 `latest`)、`roadOf`(路段判讀)、`summaryHtml`/`refreshSummary` |
| `js/pdfsummary.js` | PDF「戰情摘要首頁」(選填,`#chkPdfSummary`)與災害模式各廠所頁首小計:`drawPdfSummary`、`leadSentence`(一句話結論)、`trendNote`、`unitSubtotalLine` |
| `js/render.js` | 分頁、網頁表格 `buildTable`、圖例 |
| `js/export.js` | `exportPDF`(平常/災害)、`exportImage`、`loadFonts`、匯出選單、下載確認卡 `showFileConfirm` |
| `js/excel.js` | `exportExcel`/`buildExcelWorkbook`(每廠所一個分頁;選填:處理情形/完成時間欄、統計摘要分頁) |
| `js/dashboard.js` + `css/dashboard.css` | **災情看板外掛**(全螢幕、可另開視窗):`DASH` 狀態、交叉篩選 `rowsFor(排除維度)`、`dashRender`、時間軸拖曳 `dashPointer`、`dashPopOut`/`dashDock`。只讀全域資料,與主程式唯一耦合是 `renderFiltered()` 內的 `refreshDashboard(rows)` |
| `tests/` | Playwright 回歸測試(`golden.json` 為輸出快照) |
| `tools/build_offline.js` | 產生單一檔案離線版 `index_offline.html` |

## 規則
- **classic script,共用全域作用域**(不是 ES module,為了能 `file://` 雙擊開啟)。新增檔案:加進 `index.html` 的 script 列表(離線版建置會自動內嵌)。
- **改欄位/表頭/服務類別顏色 → 只改 `js/shared.js`**,網頁/圖片/PDF/Excel 會一起變。
- **欄寬是使用者特調值,不得更動**:`COLUMNS` 的 `imgW`/`pdfW` 與 CSS `col.cA~cL`。測試會因此失敗,這是故意的保護。
- **選填功能一律預設關閉**(統計摘要收合、Excel 選填欄、PDF 摘要首頁勾選項);未勾選時輸出必須與原本完全相同(快照會驗證)。
- 看板/摘要不顯示姓名與電話。
- 來自 Excel 的字串插入 innerHTML 前一律過 `e()` 逸出。
- 不加框架、不加新的外部函式庫、不呼叫外部網路(公家機關資安:純前端、離線可用)。
- 註解與介面文字用繁體中文。

## 資料流
`parse()` → `rawRows` → `applyAll()` → `dispRows`(已排序) → `filteredRows`(勾選篩選後) → `renderFiltered()`(套時段篩選、切成 `totalChunks`)
→ 網頁 `renderPage()` / 災情看板 / 匯出 `exportImage()` / `exportPDF()` / `exportExcel()`(共用同一份 `totalChunks`/`filteredRows`)。
`renderFiltered()` 也會呼叫 `refreshSummary(rows)`(摘要收合時不計算)與 `refreshDashboard(rows)`(看板未開時不做事)。
染色依據:平常=廠所(`unitColors`),災害=行政區(`distColors`,key 為 `distKey(r)`=地址第4~6字),統一由 `rowFill()` 決定。

## 測試與離線版
```
cd tests && npm install && npx playwright install chromium   # 第一次
npm test                # 改完程式一定跑;全綠才算沒弄壞
npm run test:dump       # 失敗時輸出實際內容到 tests/out/
npm run test:update     # 只有「確定輸出該變」時才用,並在 commit 說明改了什麼
node tools/build_offline.js   # 重產 index_offline.html(需先 npm test 全綠)
```
