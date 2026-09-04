# 需求追溯表（Requirements Traceability Matrix）

本表對應本次 Claude Code 開發指令（最高優先）、`docs/budget-system-spec-v0.4.md`（業務規格，次優先）與
`docs/requirements-original.md`（早期背景，最低優先，僅供理解脈絡）。狀態一律誠實標示，未完成或未經人工提供
真實業務資料的項目一律標示「待確認 / P1」，不虛構為已完成。

圖例：**狀態** = ✅已實作並有測試 ｜ 🟡已實作機制但需真實業務資料才能生效 ｜ ⛔尚未實作（正式上線阻擋）

---

## 一、正式部署架構

| 編號 | 需求來源 | 對應功能 | 對應程式檔案 | 測試方式 | 狀態 | P0 | 尚待確認 |
|---|---|---|---|---|---|---|---|
| DEPLOY-1 | 開發指令 §一.1 | Vercel production build 成功 | `package.json`(build script)、`next.config.mjs` | `npm run build`（本工作階段實際執行，見 README） | ✅ | 是 | - |
| DEPLOY-2 | 開發指令 §一.2 | `DATABASE_URL` 使用 Neon pooled | `prisma/schema.prisma`、`.env.example`、`NEON_SETUP.md` | `tests/deployment.test.ts` | ✅ | 是 | 需在 Vercel 專案實際設定真實 Neon pooled 連線字串 |
| DEPLOY-3 | 開發指令 §一.3 | `DIRECT_URL` 使用 Neon direct | 同上 | `tests/deployment.test.ts` | ✅ | 是 | 同上，需真實 direct 連線字串 |
| DEPLOY-4 | 開發指令 §一.4 | Migration 不可在 Vercel build 階段執行 | `package.json`(`"build": "next build"`) | `tests/deployment.test.ts` 驗證 build script 不含 migrate/seed | ✅ | 是 | - |
| DEPLOY-5 | 開發指令 §一.5 | 正式部署不得自動執行 seed | `package.json`（無 seed 綁定於 build/postinstall） | `tests/deployment.test.ts` | ✅ | 是 | - |
| DEPLOY-6 | 開發指令 §一.6 | GitHub Actions 手動執行 `prisma migrate deploy` | `.github/workflows/migrate.yml` | `tests/deployment.test.ts` 驗證 `workflow_dispatch`、無 push/schedule 觸發 | ✅ | 是 | 需在 GitHub Environment 設定真實 secrets |
| DEPLOY-7 | 開發指令 §一.7 | `/api/health` 檢查應用程式與資料庫連線 | `src/app/api/health/route.ts`、`src/lib/health/check.ts` | `tests/health.test.ts`（含模擬斷線案例） | ✅ | 是 | - |
| DEPLOY-8 | 開發指令 §一.8 | Preview 環境不得誤用正式資料庫 | `NEON_SETUP.md`（Neon branching 說明） | 文件審閱 | 🟡 | 是 | 需在 Vercel/Neon 實際設定 Preview 專屬分支資料庫，本專案僅能提供設定說明，無法代為執行 |
| DEPLOY-9 | 開發指令 §一.9 | 環境變數不寫入 Git | `.gitignore`（`.env*`）、`.env.example` 僅欄位 | `git status` 檢查 | ✅ | 是 | - |
| DEPLOY-10 | 開發指令 §一.10 | `.env.example` 僅欄位與安全範例 | `.env.example` | 人工審閱（已排除真實密鑰） | ✅ | 是 | - |

---

## 二、預算費用系統核心功能

| 編號 | 需求來源 | 對應功能 | 對應程式檔案 | 測試方式 | 狀態 | P0 | 尚待確認 |
|---|---|---|---|---|---|---|---|
| BUD-1 | 開發指令 §二.1-2 | 年度預算建立／部門填報 | `src/lib/budget/lineService.ts` (`createBudgetVersionDraft`) | `tests/workflow.test.ts` | ✅ | 是 | - |
| BUD-2 | 開發指令 §二.3 | 暫存草稿 | `BudgetStatus.DRAFT`、`updateDepartmentInputLine` | `tests/workflow.test.ts` | ✅ | 是 | - |
| BUD-3 | 開發指令 §二.4 | 送出申請 | `submitBudgetVersion` | `tests/workflow.test.ts` | ✅ | 是 | - |
| BUD-4 | 開發指令 §二.5 | 財務覆核 | `startReview` | `tests/workflow.test.ts` | ✅ | 是 | - |
| BUD-5 | 開發指令 §二.6 | 退回修改（須填原因） | `returnBudgetVersion` | `tests/workflow.test.ts` | ✅ | 是 | - |
| BUD-6 | 開發指令 §二.7 | 重新送出 | `resubmitBudgetVersion` | `tests/workflow.test.ts` | ✅ | 是 | - |
| BUD-7 | 開發指令 §二.8 | 核准 | `approveBudgetVersion` | `tests/workflow.test.ts` | ✅ | 是 | - |
| BUD-8 | 開發指令 §二.9 | 核准後鎖定 | `approveBudgetVersion`（同一交易內轉為 `LOCKED`） | `tests/workflow.test.ts` | ✅ | 是 | - |
| BUD-9 | 開發指令 §二.10 | 正式預算調整申請（新版本，不覆寫原核准版本） | `requestAdjustment` | `tests/workflow.test.ts`、`tests/reports.test.ts` | ✅ | 是 | - |
| BUD-10 | 開發指令 §二.11 | 報表查詢 | `src/app/dashboard/reports/page.tsx`、`consistencyCheck.ts` | `tests/reports.test.ts` | ✅ | 是 | 目前僅提供一致性檢核報表；多維度彙整報表（依四大類/科目別的完整篩選介面）為 P1 |
| BUD-11 | 開發指令 §二.12 | Excel 匯入與匯出 | `src/lib/excel/*` | `tests/excel.test.ts`、`tests/reports.test.ts` | ✅ | 是 | 匯出目前為單一部門版本匯出；跨部門彙總正式報表匯出為 P1 |
| BUD-12 | 開發指令 §二.13 | 完整稽核軌跡 | `src/lib/audit/log.ts`，各 workflow/import/export 動作皆呼叫 | `tests/audit.test.ts` | ✅ | 是 | - |
| BUD-13 | 開發指令 §二 | 金額一律使用 Decimal，不用浮點數 | `prisma/schema.prisma`（`Decimal(18,2)`）、`src/lib/money/decimal.ts` | 全部 workflow/formula 測試皆透過 Decimal 計算 | ✅ | 是 | - |
| BUD-14 | v0.4 §1.4 | 11 欄填報格式 | `BudgetLine` model 對應 11 欄、`BudgetVersionClient.tsx` | `tests/excel.test.ts`（模板欄位驗證） | ✅ | 是 | - |
| BUD-15 | v0.4 §1.5 | 推移數缺月份標示「資料不全，待確認」 | `BudgetLine.projectionIsComplete` | UI 呈現於 `BudgetVersionClient.tsx`；匯入邏輯保留欄位但完整月份回填管線為 P1 | 🟡 | 否 | 需要真實 ALLINONE 逐月資料匯入流程（P1，尚未實作專用匯入端點） |
| BUD-16 | v0.4 §5.1 | 部門對科目雙向加總一致性檢核 | `src/lib/reports/consistencyCheck.ts` | `tests/reports.test.ts` | ✅ | 是 | - |
| BUD-17 | v0.4 §3.3 | 逾期提醒與缺件標記 | 未實作（需排程/通知系統） | - | ⛔ | 否（P1） | 需排程通知機制（email/系統內通知），本次未實作 |
| BUD-18 | v0.4 §3.1 | 總費用限 X% 規則 | 依 v0.4 v0.4 本版「暫緩不執行」，且開發指令未要求 | - | 不適用 | 否 | 依規格書 v0.4 明確暫緩，未實作屬正確行為，非缺陷 |

---

## 三、記憶功能（業務記憶，非聊天式記憶）

| 編號 | 需求來源 | 對應功能 | 對應程式檔案 | 測試方式 | 狀態 | P0 | 尚待確認 |
|---|---|---|---|---|---|---|---|
| MEM-1 | 開發指令 §三 | 前一年度核准預算 | `MemoryType.PRIOR_YEAR_APPROVED_BUDGET`，於 `approveBudgetVersion` 自動寫入 | `tests/workflow.test.ts` | ✅ | 是 | - |
| MEM-2 | 開發指令 §三 | 過去年度實際數／比較基準 | `MemoryType.PRIOR_YEAR_ACTUAL`（模型已定義，資料來源需匯入 ALLINONE 實績，P1） | 型別存在，寫入管線待建 | 🟡 | 否 | 需要 ALLINONE 實績匯入功能（P1） |
| MEM-3 | 開發指令 §三 | 歷次送審版本 | `BudgetVersion.versionNumber` 鏈、`MemoryType.SUBMISSION_VERSION`（型別已定義） | `tests/workflow.test.ts`（版本鏈驗證） | ✅ | 是 | - |
| MEM-4 | 開發指令 §三 | 使用者草稿 | `MemoryType.USER_DRAFT` | `src/lib/memory/service.ts` | ✅ | 是 | - |
| MEM-5 | 開發指令 §三 | 財務退回原因 | `MemoryType.RETURN_REASON`，`returnBudgetVersion` 自動寫入 | `tests/workflow.test.ts` | ✅ | 是 | - |
| MEM-6 | 開發指令 §三 | 人工調整紀錄 | `MemoryType.MANUAL_ADJUSTMENT`，`requestAdjustment` 自動寫入 | `tests/workflow.test.ts` | ✅ | 是 | - |
| MEM-7 | 開發指令 §三 | 常用查詢條件／欄位偏好 | `MemoryType.QUERY_PREFERENCE` / `FIELD_PREFERENCE` | `tests/memory.test.ts` | ✅ | 是 | - |
| MEM-8 | 開發指令 §三 | 本期與前期差異、金額與百分比差異 | `MemoryType.PERIOD_VARIANCE` / `AMOUNT_PERCENT_VARIANCE`（型別已定義），成長率計算已在 `deriveLineTotals` | 成長率計算：`tests/workflow.test.ts` 間接涵蓋；獨立差異報表 UI 為 P1 | 🟡 | 否 | 差異記憶的自動寫入管線與報表 UI 為 P1 |
| MEM-9 | 開發指令 §三.1 | 每筆記憶皆有來源／建立時間／建立人／適用範圍 | `MemoryEntry` schema（`source`, `createdAt`, `createdById`, `scopeDepartmentId`, `fiscalYear` 皆為必要或可稽核欄位） | `tests/memory.test.ts` | ✅ | 是 | - |
| MEM-10 | 開發指令 §三.2-3 | 僅能讀取有權限部門/年度，不可洩漏他部門敏感預算 | `listMemoryEntries` 強制 department scope 過濾 | `tests/memory.test.ts`（跨部門讀取阻擋） | ✅ | 是 | - |
| MEM-11 | 開發指令 §三.4 | 使用者可清除個人偏好，不可刪除依法/內控保留紀錄 | `deleteOwnMemoryEntry`（`isUserDeletable` 旗標） | `tests/memory.test.ts` | ✅ | 是 | - |
| MEM-12 | 開發指令 §三.5 | 系統建議不得直接覆寫正式預算 | 系統中沒有任何路徑讓 `MemoryEntry` 直接寫入 `BudgetLine`；寫入一律經 `updateDepartmentInputLine` 由人工提交 | 架構檢視 + `tests/memory.test.ts` | ✅ | 是 | - |
| MEM-13 | 開發指令 §三.6 | AI 建議需標示並經人員確認、覆寫需理由 | `aiSuggested` / `aiConfirmedById` / `overrideReason` 欄位，`confirmAiSuggestion` / `overrideAiSuggestion` | `tests/memory.test.ts` | ✅ | 是 | 目前系統尚未接入實際 AI 建議產生器（無 AI 推薦邏輯），僅提供「若未來接入 AI，必須遵循的確認/覆寫機制」；不虛構 AI 功能 |

---

## 四、人類監督與內控

| 編號 | 需求來源 | 對應功能 | 對應程式檔案 | 測試方式 | 狀態 | P0 | 尚待確認 |
|---|---|---|---|---|---|---|---|
| CTL-1 | 開發指令 §四 | 提報人與最終核准人不得為同一人 | `approveBudgetVersion`（segregation check） | `tests/workflow.test.ts` | ✅ | 是 | - |
| CTL-2 | 開發指令 §四 | 財務覆核人不得核准自己建立/修改的資料 | `approveBudgetVersion`（`reviewedById` 亦納入檢查） | `tests/workflow.test.ts` | ✅ | 是 | - |
| CTL-3 | 開發指令 §四 | 送出後填報人不得直接修改，須財務退回 | `updateDepartmentInputLine`（`isEditable` 狀態檢查） | `tests/workflow.test.ts` | ✅ | 是 | - |
| CTL-4 | 開發指令 §四 | 核准後資料鎖定 | `BudgetStatus.LOCKED`，`isEditable` 排除 LOCKED | `tests/workflow.test.ts` | ✅ | 是 | - |
| CTL-5 | 開發指令 §四 | 核准後調整建立新版本，不覆寫原核准版本 | `requestAdjustment` | `tests/workflow.test.ts` | ✅ | 是 | - |
| CTL-6 | 開發指令 §四 | 退回必須填寫原因 | `returnBudgetVersion`（reason 必填） | `tests/workflow.test.ts` | ✅ | 是 | - |
| CTL-7 | 開發指令 §四 | 人工覆寫系統建議需填理由 | `overrideAiSuggestion`（reason 必填） | `tests/memory.test.ts` | ✅ | 是 | - |
| CTL-8 | 開發指令 §四 | 異常金額應人工覆核，不得自動核准 | 系統設計上**沒有任何自動核准路徑**——`approveBudgetVersion` 永遠需要具 `FINANCE_APPROVER` 權限之人員主動呼叫 | 架構檢視；`tests/workflow.test.ts` 證明核准恆為人工動作 | ✅ | 是 | 尚未實作「異常金額自動標記」告警規則（例如成長率超過門檻時的視覺警示），因規格未提供具體門檻數字，不自行假設業務規則；此為 P1，需財務提供門檻 |
| CTL-9 | 開發指令 §四 | 高風險操作支援雙人覆核／第二層核准 | `DualControlRequest` model、`src/lib/security/dualControl.ts`（用於角色變更） | 覆蓋角色變更情境；預算解鎖等其他高風險操作的雙人覆核為 P1 | 🟡 | 是（角色變更已覆蓋） | 「正式預算解鎖」目前的設計是不允許直接解鎖已鎖定版本（只能走調整申請新版本），故無需額外解鎖雙人覆核；如需支援其他高風險動作的雙人覆核，需列出具體動作清單 |
| CTL-10 | 開發指令 §四 | 所有狀態變動/金額變動/權限操作皆留稽核紀錄 | `writeAuditLog` 呼叫遍及所有 workflow/import/export/dual-control/memory 動作 | `tests/audit.test.ts` | ✅ | 是 | - |
| CTL-11 | 開發指令 §四 | 明確狀態機（9 狀態）且後端驗證每個狀態允許的操作 | `src/lib/workflow/stateMachine.ts`、`actions.ts` | `tests/workflow.test.ts` | ✅ | 是 | - |

---

## 五、角色與權限

| 編號 | 需求來源 | 對應功能 | 對應程式檔案 | 測試方式 | 狀態 | P0 | 尚待確認 |
|---|---|---|---|---|---|---|---|
| RBAC-1 | 開發指令 §五 | 8 種角色皆實作 | `prisma/schema.prisma`（`Role` enum） | `tests/rbac.test.ts` | ✅ | 是 | - |
| RBAC-2 | 開發指令 §五 | 權限一律由後端檢查 | `src/lib/rbac/guard.ts`、`permissions.ts`，所有 API route 皆呼叫 `requireCapability`/`requireDepartmentAccess` | `tests/rbac.test.ts` | ✅ | 是 | - |
| RBAC-3 | 開發指令 §五 | 禁止僅依賴前端控制 | 前端按鈕僅為呈現，所有動作皆需通過後端 `assertTransition` + capability 檢查 | `tests/workflow.test.ts`（直接呼叫 service 驗證後端獨立擋下） | ✅ | 是 | - |
| RBAC-4 | 開發指令 §五 | 使用者不可自行指定角色 | `Role` 僅能由 `SYSTEM_ADMIN` 透過雙人覆核（`DualControlRequest`）變更，一般使用者無任何 API 可自行修改 `role` 欄位 | 架構檢視（無使用者可寫入 `role` 的 API） | ✅ | 是 | - |
| RBAC-5 | 開發指令 §五 | API 參數不得決定可視部門（防 IDOR） | 所有查詢皆以 `requireDepartmentAccess` / `getAccessibleDepartmentIds` 為準，不信任前端傳入的 departmentId | `tests/rbac.test.ts` | ✅ | 是 | - |
| RBAC-6 | 開發指令 §五 | 一般使用者不可存取全公司資料 | `companyWide` + `UserDepartmentScope` 設計 | `tests/rbac.test.ts` | ✅ | 是 | - |
| RBAC-7 | 開發指令 §五 | 未授權不得匯出正式預算 | `exportApprovedBudgetVersion` 要求 `report.export_official` capability + department access | `tests/reports.test.ts` | ✅ | 是 | - |

---

## 六、正式主檔與公式

| 編號 | 需求來源 | 對應功能 | 對應程式檔案 | 測試方式 | 狀態 | P0 | 尚待確認 |
|---|---|---|---|---|---|---|---|
| MASTER-1 | 開發指令 §六.1 | 不虛構正式 239 筆科目 | 系統未內建任何科目種子資料 | `Account` 資料表在未匯入前為空 | ✅ | 是 | 需財務提供真實 239 筆科目清單（原始 Excel「科目清單」分頁）透過匯入功能建檔 |
| MASTER-2 | 開發指令 §六.2 | 受控的科目/部門/使用者/權限匯入功能 | `src/lib/importing/masterDataImport.ts`、`/api/imports/*` | `tests/import.test.ts` | ✅ | 是 | - |
| MASTER-3 | 開發指令 §六.3 | 匯入前欄位驗證/重複檢查/錯誤預覽 | 同上（`preview*Import` 函式） | `tests/import.test.ts` | ✅ | 是 | - |
| MASTER-4 | 開發指令 §六.4 | 匯入使用 Transaction，失敗全部回滾 | `prisma.$transaction` 包覆所有 commit 函式 | `tests/import.test.ts`（明確驗證回滾情境） | ✅ | 是 | - |
| MASTER-5 | 開發指令 §六.5 | FORMULA 科目不可默默回傳 0 | `src/lib/formula/engine.ts`（未設定時回傳 `NOT_CONFIGURED`，`amount: null`） | `tests/formula.test.ts` | ✅ | 是 | - |
| MASTER-6 | 開發指令 §六.6 | 公式/薪資資料未提供時標示「尚未設定」 | `FormulaStatus.NOT_CONFIGURED`，UI 顯示於 `BudgetVersionClient.tsx` | `tests/formula.test.ts` | ✅ | 是 | - |
| MASTER-7 | 開發指令 §六.7 | FORMULA 未設定時禁止送出/核准 | `assertNoUnconfiguredFormulas`（`submitBudgetVersion`、`approveBudgetVersion`、`resubmit` 皆檢查） | `tests/workflow.test.ts` | ✅ | 是 | - |
| MASTER-8 | 開發指令 §六.8 | 可擴充公式設定方式，記錄版本與生效日 | `FormulaDefinition`（`version`, `effectiveFrom`, `effectiveTo`） | `tests/formula.test.ts` | ✅ | 是 | 目前公式引擎支援 3 種運算型態（`salary_multiple`／`per_employee_flat`／`percent_of_accounts`），對應 v0.4 §2 已知範例；若有更複雜公式型態需擴充 `FormulaExpression` |
| MASTER-9 | 開發指令 §六.9 | 薪資敏感資料不暴露給無權限部門使用者 | `canViewSalaryDetail`，`/api/budgets/[id]` 回應標記 `salaryDetailRestricted` | 架構檢視 + `permissions.ts` | ✅ | 是 | - |

---

## 七、登入與資安

| 編號 | 需求來源 | 對應功能 | 對應程式檔案 | 測試方式 | 狀態 | P0 | 尚待確認 |
|---|---|---|---|---|---|---|---|
| SEC-1 | 開發指令 §七 | 密碼安全雜湊 | `src/lib/auth/password.ts`（bcrypt, 12 rounds） | `tests/auth.test.ts` | ✅ | 是 | - |
| SEC-2 | 開發指令 §七 | 密碼/token/secret 不寫入 log | 全域無 `console.log` 記錄請求體；`errorResponse` 只記錄 error 物件本身 | 人工程式碼審閱 | ✅ | 是 | - |
| SEC-3 | 開發指令 §七 | 登入錯誤訊息不暴露帳號是否存在 | `/api/auth/login`（一律回傳「帳號或密碼錯誤」） | 程式碼審閱 | ✅ | 是 | - |
| SEC-4 | 開發指令 §七 | 登入失敗限制/鎖定機制 | `src/lib/auth/rateLimit.ts`（5 次失敗鎖定 15 分鐘） | `tests/auth.test.ts` | ✅ | 是 | - |
| SEC-5 | 開發指令 §七 | 安全密碼重設流程 | `/api/auth/password-reset/*`（雜湊 token、30 分鐘過期、一次性使用） | 程式碼審閱；`checkPasswordPolicy` 測試涵蓋密碼強度 | 🟡 | 是 | **尚未串接真正的 Email 發送**，目前 reset token 僅在非正式環境的 API 回應中回傳供開發測試；正式上線前必須串接 Email 服務，否則使用者無法收到重設連結（已在程式碼與 OPERATIONS.md 標註為上線前必辦事項） |
| SEC-6 | 開發指令 §七 | Session/Cookie 安全設定 | `src/lib/auth/session.ts`（httpOnly, secure(prod), sameSite=lax） | 程式碼審閱 | ✅ | 是 | - |
| SEC-7 | 開發指令 §七 | API 輸入使用 schema 驗證 | `src/lib/validation/schemas.ts`（zod），各路由呼叫 `.parse()` | 涵蓋於各功能測試 | ✅ | 是 | - |
| SEC-8 | 開發指令 §七 | 防 SQL injection/XSS/CSRF/IDOR | Prisma 參數化查詢；React 自動跳脫；`assertSameOrigin`；`requireDepartmentAccess` | `tests/rbac.test.ts`、程式碼審閱 | ✅ | 是 | - |
| SEC-9 | 開發指令 §七 | 正式環境錯誤訊息不暴露堆疊/資料庫資訊 | `errorResponse()`（一律回傳通用訊息，`console.error` 僅寫入伺服器端日誌） | `tests/health.test.ts`（驗證健康檢查不洩漏錯誤細節） | ✅ | 是 | - |
| SEC-10 | 開發指令 §七 | 安全 headers | `next.config.mjs`（CSP、HSTS、X-Frame-Options 等） | 程式碼審閱 | ✅ | 是 | - |
| SEC-11 | 開發指令 §七 | 為未來 SSO/MFA 預留介面 | `User.ssoSubject`、`User.mfaEnabled` 欄位保留 | 架構審閱 | 🟡 | - | 明確**未實作** SSO/MFA 本身（依指示不做假功能）。**正式上線阻擋項目**：若公司要求 MFA/SSO 才能上線，需另行整合（見 SECURITY.md「SSO/MFA 整合說明」） |

---

## 八、Excel 匯入與匯出

| 編號 | 需求來源 | 對應功能 | 對應程式檔案 | 測試方式 | 狀態 | P0 | 尚待確認 |
|---|---|---|---|---|---|---|---|
| XLS-1 | 開發指令 §八.1 | 匯入模板有版本號 | `TEMPLATE_VERSIONS`（`src/lib/importing/masterDataImport.ts`）、`ImportBatch.templateVersion` | `tests/import.test.ts` | ✅ | 是 | - |
| XLS-2 | 開發指令 §八.2 | 檢查欄位/格式/年度/部門/科目/金額 | `previewDepartmentImport`/`previewAccountImport`/`previewUserImport`/`parseBudgetLineWorkbook` | `tests/import.test.ts`、`tests/excel.test.ts` | ✅ | 是 | - |
| XLS-3 | 開發指令 §八.3 | 匯入前錯誤預覽 | 所有匯入 API 皆支援 `mode=preview` | `tests/import.test.ts`、`tests/excel.test.ts` | ✅ | 是 | - |
| XLS-4 | 開發指令 §八.4 | 匯入成功留下批次編號與稽核紀錄 | `ImportBatch` + `writeAuditLog` | `tests/import.test.ts` | ✅ | 是 | - |
| XLS-5 | 開發指令 §八.5 | 同檔案重複上傳偵測 | `fileHash` + `ImportBatch` unique 約束、`assertNotDuplicateUpload` | `tests/import.test.ts` | ✅ | 是 | - |
| XLS-6 | 開發指令 §八.6 | 正式報表只含已核准版本 | `exportApprovedBudgetVersion`（限 `LOCKED`/`ADJUSTED`） | `tests/reports.test.ts` | ✅ | 是 | - |
| XLS-7 | 開發指令 §八.7 | 匯出權限後端驗證 | `requireCapability(user, "report.export_official")` | `tests/reports.test.ts` | ✅ | 是 | - |
| XLS-8 | 開發指令 §八.8 | 防 Excel 公式注入 | `src/lib/excel/sanitize.ts`（匯出時加註記號）、匯入時拒絕公式儲存格 | `tests/excel.test.ts` | ✅ | 是 | - |
| XLS-9 | 開發指令 §八.9 | 金額/日期/中文欄位格式正確 | `Decimal` 金額欄位、UTF-8 中文欄名、`exceljs` 原生支援中文 | `tests/excel.test.ts` | ✅ | 是 | - |

---

## 九、測試與驗收

| 編號 | 對應驗收項目 | 測試檔案 | 狀態 |
|---|---|---|---|
| TEST-1 | 登入及未登入存取 | `tests/auth.test.ts`、`tests/rbac.test.ts`（`requireUser`/`requireCapability` 401/403） | ✅ |
| TEST-2 | 角色權限 | `tests/rbac.test.ts` | ✅ |
| TEST-3 | 跨部門越權 | `tests/rbac.test.ts` | ✅ |
| TEST-4 | 狀態轉換 | `tests/workflow.test.ts` | ✅ |
| TEST-5 | 退回與重新送出 | `tests/workflow.test.ts` | ✅ |
| TEST-6 | 核准後鎖定 | `tests/workflow.test.ts` | ✅ |
| TEST-7 | 核准後調整 | `tests/workflow.test.ts`、`tests/reports.test.ts` | ✅ |
| TEST-8 | FORMULA 未設定禁止送出 | `tests/workflow.test.ts`、`tests/formula.test.ts` | ✅ |
| TEST-9 | 匯入驗證與 Transaction 回滾 | `tests/import.test.ts` | ✅ |
| TEST-10 | 正式報表只匯出核准資料 | `tests/reports.test.ts` | ✅ |
| TEST-11 | 稽核紀錄不可由一般使用者修改或刪除 | `tests/audit.test.ts`（含掃描全部 API route 無 mutate handler） | ✅ |
| TEST-12 | Neon 資料庫斷線時的健康檢查 | `tests/health.test.ts`（模擬無法連線的 client） | ✅ |
| TEST-13 | GitHub Actions migration 設定 | `tests/deployment.test.ts` | ✅ |

**實際執行結果**（見 README「測試與驗收結果」章節）：`npm run lint`、`npx tsc --noEmit`、`npm test`（53 tests）、`npm run build` 皆已於本工作階段實際執行並通過，非憑空宣稱。

---

## 已知限制與 P1 待辦（非 P0 上線阻擋，但建議儘早規劃）

1. 逾期提醒/排程通知（v0.4 §3.3）尚未實作，需排程系統（如 Vercel Cron + Email）。
2. ALLINONE 逐月實際數的專用匯入端點尚未實作（`BudgetLineMonthlyActual` 模型已就緒，缺匯入 API）。
3. 多維度彙整報表（四大類 × 科目別的完整篩選/樞紐介面）僅有一致性檢核頁面，尚無完整報表 UI。
4. PDF 匯出未實作（依開發指令列為 P1，正確）。
5. 除「角色變更」外，其他高風險操作的雙人覆核尚未逐一列舉實作（`DualControlRequest` 架構已可擴充）。
6. Email 寄送（密碼重設信、退回通知等）尚未串接真實郵件服務。

## P0 上線阻擋項目（必須在正式上線前解決，見 README「是否具備正式上線條件」）

1. 真實 Neon Production/Preview 資料庫尚未建立與連接（本次工作階段不得且未接觸正式 Neon）。
2. 真實會計科目（239 筆）、部門主管、財務覆核/核准人員名單尚未匯入（v0.4 中對應資料為模擬或待確認，依指示不可虛構代入）。
3. 密碼重設信件尚未串接真實 Email 服務。
4. MFA/SSO 若為上線硬性要求，尚未實作（依指示不做假功能）。
5. 海外據點部門的四大類歸屬（v0.4 §6）尚待財務確認。
