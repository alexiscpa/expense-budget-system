# 維運手冊（OPERATIONS.md）

## 1. 初次上線 — Bootstrap 第一個管理員帳號

系統沒有任何內建/種子帳號。正式資料庫 migration 完成後，需要手動建立第一個 `SYSTEM_ADMIN`，才能登入並開始
透過受控匯入功能建立真實的部門、科目、使用者主檔。

```bash
# 於本機或有資料庫網路連線的環境執行（例如暫時在本機指向 production DIRECT_URL）
ADMIN_EMAIL="finance-admin@yourcompany.com" \
ADMIN_PASSWORD="請填入符合密碼政策的高強度密碼" \
ADMIN_NAME="王小明" \
DATABASE_URL="<production DATABASE_URL>" \
DIRECT_URL="<production DIRECT_URL>" \
npm run bootstrap:admin
```

注意事項：

- 此腳本（`scripts/bootstrap-admin.ts`）**不會**在 Vercel build 或任何自動化流程中執行，必須手動執行一次。
- 密碼僅透過環境變數傳遞、雜湊後即寫入資料庫，執行完成後請立即從 shell history / 環境變數中清除。
- 之後若要新增更多管理員或一般使用者，一律透過系統內的「使用者匯入」功能（`/api/imports/users`），不要再次
  執行此腳本（除非是要重設某個 admin 帳號的密碼與角色）。

## 2. 建立真實主檔資料（科目 / 部門 / 使用者）

以 `SYSTEM_ADMIN` 登入後：

1. **部門**：透過 `/api/imports/departments` 匯入（`mode: "preview"` 先預覽，確認無誤後 `mode: "commit"`）。
   `docs/budget-system-spec-v0.4.md` §1.2 的部門清單為財務團隊確認過的真實資料，可作為匯入依據；「待確認」
   （海外據點）部門請先以 `class: "UNCLASSIFIED"` 匯入，待財務確認四大類歸屬後再更新。
2. **會計科目**：透過 `/api/imports/accounts` 匯入。**系統不內建任何科目資料**，239 筆科目清單必須由財務
   單位提供原始「科目清單」分頁資料，依 `previewAccountImport` 要求的欄位格式整理後匯入。FORMULA 類型科目
   務必填寫 `formulaKey`，否則會被匯入驗證擋下（避免有科目變成永遠「尚未設定」卻沒人發現）。
3. **使用者**：透過 `/api/imports/users` 匯入。**不要**匯入 v0.4 規格書中標註「模擬」的部門主管/管理員姓名
   （如「王小明（模擬）」），那些僅為規格文件示範格式，必須替換為真實人員的 email 與姓名。匯入後系統會為
   每位使用者建立一次性密碼重設 token（回應中的 `resetToken`），需人工透過安全管道（如企業內部通訊軟體，
   **不要**用一般 email 明碼傳送）通知使用者設定密碼；正式上線前應改為自動寄送重設信（見 SECURITY.md）。
4. **公式設定**：財務單位確認薪資計算公式後，由 `SYSTEM_ADMIN` 透過 Prisma Studio 或後續補充的公式管理
   API（目前需直接於資料庫建立 `FormulaDefinition` 記錄，附上 `effectiveFrom`／`version`）建立公式。同時需
   匯入對應的 `SalaryDataSource`（各部門每月薪資彙總數與人數），FORMULA 科目才會由「尚未設定」變成可計算。

## 3. 執行 Prisma Migration

見 `VERCEL_DEPLOYMENT.md` 第 5 節與 `NEON_SETUP.md` 第 4 節。摘要：

1. GitHub → Actions → **Deploy Database Migrations** → Run workflow。
2. 選擇 `environment`（`production` 或 `preview`）。
3. 確認 workflow 執行成功（`prisma migrate deploy` + `prisma migrate status` 皆綠燈）。

## 4. 驗證 `/api/health`

```bash
curl -s https://<domain>/api/health | jq
```

正常回應 `status: "ok"`、`database: "ok"`。若 `database: "unreachable"`，代表應用程式**存活**但**無法連線
資料庫**，常見原因：

- `DATABASE_URL` 設定錯誤或 Neon 專案/分支被刪除、暫停。
- Neon 免費方案的自動休眠（compute auto-suspend）剛好在冷啟動中（通常數秒內恢復，可重試）。
- Neon 連線數已達上限（檢查是否有洩漏連線的程式碼，或 pooled 連線字串設定錯誤變成走 direct 連線）。

## 5. 回滾應用程式

見 `VERCEL_DEPLOYMENT.md` 第 7 節（Vercel Promote to Production 至先前部署）。

## 6. 資料庫 Migration 失敗處理

見 `VERCEL_DEPLOYMENT.md` 第 8 節。

## 7. 備份與還原演練

建議至少每季演練一次，確保「以為有備份」不會變成上線事故時才發現備份不能用：

1. **建立演練分支**：於 Neon Console 選擇 Production 分支 → **Restore** → 選擇一個過去的時間點（Point-in-
   Time Restore），但**不要**直接還原到 Production 分支本身，而是選擇「Create new branch from this point」
   建立一個獨立的還原測試分支，避免影響正式環境。
2. **驗證資料完整性**：取得該還原分支的連線字串，本機以 `psql` 連線，抽查關鍵資料表（`BudgetVersion`、
   `AuditLog`、`Account`）的筆數與最新幾筆記錄時間，確認還原時間點符合預期。
3. **驗證應用程式可用該分支啟動**：可選擇性地將還原分支的連線字串暫時設定到一個獨立的 Vercel Preview
   部署，確認應用程式能正常讀寫（僅供演練驗證，演練後應刪除該臨時分支與 Preview 部署，不可流入正式流程）。
4. **記錄演練結果**：演練完成後刪除臨時分支（Neon Console → Branches → Delete），並記錄本次演練的還原
   時間點、耗時、發現的問題於內部維運文件，作為下次真正需要還原時的參考。

**真正發生資料事故需要還原正式環境時**（非演練）：

1. 立即透過 Vercel 將應用程式導向維護頁面或降級模式，避免還原期間持續寫入不一致的資料（若尚未實作維護模式
   開關，最快的作法是暫時將 Production 部署 Promote 回一個唯讀/停用寫入的版本，或直接於 Neon 端暫停該
   compute 阻斷連線）。
2. 依上方演練步驟 1 執行「Create new branch from this point」，**先在還原分支確認資料正確**，不要直接對
   Production 分支執行不可逆的還原操作。
3. 確認無誤後，再依 Neon 文件將 Production 分支指向正確的還原狀態（依當時 Neon 方案提供的機制，可能是
   直接還原 Production 分支，或將驗證過的還原分支提升為新的 Production 分支並更新 Vercel 環境變數指向它）。
4. 還原後執行 `/api/health` 與關鍵功能（登入、查看預算版本、稽核紀錄）人工驗證，並在 `AuditLog` 之外另行
   記錄本次事故的時間軸、影響範圍與根因分析。

## 8. 例行維運檢查清單

- [ ] `/api/health` 監控是否正常（建議接外部 uptime 服務）
- [ ] GitHub Actions migration workflow 的執行紀錄是否都成功
- [ ] Neon 專案的連線數、儲存空間是否接近方案上限
- [ ] `LoginAttempt` 是否有異常大量失敗（可能為暴力破解嘗試）
- [ ] `AuditLog` 中 `ACCESS_DENIED_CROSS_DEPARTMENT` 是否有異常頻繁的紀錄（可能為越權嘗試）
