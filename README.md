# 部門費用預算編列系統（Expense Budget System）

企業年度費用預算編列、財務覆核、核准、鎖定與稽核追蹤系統。Next.js 14（App Router）+ TypeScript + Tailwind CSS
+ Prisma + PostgreSQL（Neon）。

> 本專案是從空的 GitHub repository 全新建置（開發時確認過原 repository 沒有任何既有程式碼），依
> `docs/budget-system-spec-v0.4.md`（業務規格）與本次開發指令建置。詳細需求對應請見
> [`docs/requirements-traceability.md`](docs/requirements-traceability.md)。

## 技術架構

- **前端**：Next.js 14 App Router、React 18、TypeScript（strict mode）、Tailwind CSS
- **後端**：Next.js Route Handlers（`src/app/api/**/route.ts`）
- **資料庫**：PostgreSQL，正式環境使用 [Neon](https://neon.tech)（見 `NEON_SETUP.md`）
- **ORM**：Prisma，金額欄位一律使用 `Decimal(18,2)`，程式中透過 `decimal.js` 運算，禁止使用浮點數
- **驗證**：zod schema 驗證所有 API 輸入
- **認證**：email + bcrypt 密碼雜湊 + httpOnly JWT session cookie（見 `SECURITY.md`）
- **測試**：Vitest，針對真實 PostgreSQL（本機安裝的 postgres，非 Neon）執行整合測試
- **部署**：GitHub → Vercel（Production + Preview）；Neon 為正式資料庫；GitHub Actions 手動觸發
  `prisma migrate deploy`

## 目錄結構

```
src/
  app/                  Next.js App Router 頁面與 API routes
    api/                後端 API（health / auth / budgets / imports / memory / audit / dual-control / reports）
    login/ dashboard/…  前端頁面
  lib/
    auth/               密碼雜湊、session、登入鎖定
    rbac/               角色權限矩陣、後端權限檢查
    workflow/           預算狀態機與各項狀態轉換動作
    budget/             預算列（BudgetLine）服務、金額衍生計算
    formula/            FORMULA 科目公式引擎（版本化、生效日期）
    memory/             業務記憶（來源/時間/建立人/範圍皆可追溯）
    importing/          科目/部門/使用者的受控匯入（Transaction + 驗證 + 錯誤預覽）
    excel/              預算列 Excel 匯入/匯出、公式注入防護
    reports/            部門對科目雙向加總一致性檢核
    security/           CSRF 防護、雙人覆核（Dual Control）
    audit/               稽核紀錄寫入（append-only）
    health/               健康檢查邏輯（可獨立測試）
prisma/
  schema.prisma          資料模型（含所有 enum、狀態機、稽核、記憶模型）
  migrations/             Prisma migration 歷史
tests/                    Vitest 整合測試（對真實 PostgreSQL 執行）
docs/
  budget-system-spec-v0.4.md   業務規格（次優先依據）
  requirements-original.md      早期背景需求（最低優先，僅供理解脈絡）
  requirements-traceability.md  需求追溯表
.github/workflows/
  migrate.yml            手動觸發的正式 migration workflow
  ci.yml                 每次 push/PR 執行 lint/typecheck/test/build
```

## 開發環境設定

```bash
npm ci
cp .env.example .env      # 依本機 PostgreSQL 或個人 Neon 開發分支調整連線字串
npx prisma migrate dev    # 建立/套用本機開發資料庫 schema
npm run dev
```

## 測試

測試針對真實 PostgreSQL 執行整合測試（非 mock），需要本機（或 CI）有一個可連線的 PostgreSQL 服務：

```bash
# 建立測試資料庫（一次性）
createdb expense_budget_test   # 或用 psql: CREATE DATABASE expense_budget_test;

# 套用 schema 到測試資料庫
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/expense_budget_test?schema=public" \
DIRECT_URL="postgresql://postgres:postgres@localhost:5432/expense_budget_test?schema=public" \
npx prisma migrate deploy

npm test
```

`vitest.config.ts` 已內建測試資料庫連線字串（本機專用、非機密資訊），CI（`.github/workflows/ci.yml`）會透過
GitHub Actions 內建的方式另外準備測試環境變數。

## 常用指令（`package.json` scripts）

| 指令 | 說明 |
|---|---|
| `npm run dev` | 啟動本機開發伺服器 |
| `npm run build` | 正式環境建置（`next build`，不含 migrate/seed） |
| `npm run lint` | ESLint |
| `npm run typecheck` | `tsc --noEmit` |
| `npm test` | Vitest 整合測試 |
| `npm run prisma:migrate:dev` | 本機開發環境建立/套用 migration |
| `npm run prisma:migrate:deploy` | 正式/測試環境套用既有 migration（不會產生新 migration） |
| `npm run bootstrap:admin` | 一次性建立第一個 `SYSTEM_ADMIN`（見 `OPERATIONS.md`） |

## 測試與驗收結果（本次工作階段實際執行）

以下指令已在本次開發工作階段中**實際執行**，結果如下（並非未執行就宣稱通過）：

| 指令 | 結果 |
|---|---|
| `npx prisma format` | ✅ 成功 |
| `npx prisma validate` | ✅ Schema 有效 |
| `npm run lint`（`eslint . --max-warnings=0`） | ✅ 0 錯誤、0 警告 |
| `npx tsc --noEmit` | ✅ 無型別錯誤 |
| `npm test`（Vitest，對本機真實 PostgreSQL 執行） | ✅ **11 個測試檔、53 個測試，全數通過** |
| `npm run build`（`next build`） | ✅ 成功產出 production build |

測試涵蓋範圍見 [`docs/requirements-traceability.md`](docs/requirements-traceability.md) 第九節「測試與驗收」。

### 本次新增：Preview 免登入 Demo 模式（本次工作階段實際執行結果）

以下是「Preview 專用免登入 Demo 模式」這次變更在**本次工作階段**中**實際執行**的結果，如同上方原則，
未實際執行的項目一律誠實列為「未驗證」，不宣稱通過：

| 指令/項目 | 結果 |
|---|---|
| `npm run lint`（`eslint . --max-warnings=0`，含本次新增/修改的全部檔案） | ✅ 0 錯誤、0 警告，**已實際執行** |
| `tests/auth-bypass.test.ts`（不依賴資料庫／Prisma engine 的純邏輯測試，直接以 `npx vitest run` 執行） | ✅ **23 個測試，全數通過，已實際執行** |
| `tests/auth-bypass-db.test.ts`（需要真實資料庫連線＋已產生的 Prisma Client 的測試，如虛擬身分未寫入
  User 資料表、稽核紀錄 `actorUserId`/`reason` 標記） | ⚠️ **未執行**——本次工作階段的網路環境無法連線
  `binaries.prisma.sh`（`x-deny-reason: host_not_allowed`），僅匯入 `@/lib/prisma` 就會在模組載入階段
  丟出 `@prisma/client did not initialize yet`，連測試都無法開始收集，非測試邏輯本身的問題。已將這類
  測試獨立成單一檔案，方便下一個有完整網路權限的階段單獨執行並回報結果。 |
| `npm run typecheck`（`tsc --noEmit`） | ⚠️ **未完整執行**——同上述 Prisma Client 未產生的原因，會在既有
  （本次未修改的）多個檔案報 `Role`／`Prisma.InputJsonValue` 等型別缺失錯誤；已確認錯誤清單皆屬既有檔案，
  非本次新增程式碼造成。 |
| `npm test`（`vitest run`，全部測試檔） | ⚠️ **未完整執行**——同上，任何會匯入 `@/lib/prisma` 的測試檔（含
  本次新增的 `tests/auth-bypass-db.test.ts` 與既有絕大多數測試檔）皆無法在本環境載入。 |
| `npm run build`（`next build`） | ⚠️ **未完整執行**——webpack/SWC 編譯階段成功，但接續的型別檢查階段因同一
  Prisma Client 問題而失敗；未產出可部署的 production build。 |

上述「未驗證」項目請在具備 `binaries.prisma.sh` 網路存取權限（或已預先產生 Prisma Client）的環境重新執行
`npm ci && npx prisma generate && npm run typecheck && npm test && npm run build` 後再行確認。

### 本次新增：Preview DEMO 主檔初始化 ＋ 手動建立測試預算

在「Preview 免登入 Demo 模式」基礎上，新增了讓測試管理員在畫面上**親自**建立與輸入測試預算的完整路徑：

- Dashboard 新增「初始化 DEMO 主檔」按鈕（僅在 `isAuthBypassEnabled()` 為真時顯示；後端 `POST /api/demo/seed`
  同樣以此為硬性前提），建立固定的 1 個 `DEMO-DEPT` 測試部門與 3 個 `DEMO-ACC-*` 一般費用測試科目，以
  `upsert` 實作、可重複執行不產生重複資料，且從不建立任何 `BudgetVersion`／`BudgetLine`——預算金額必須由
  使用者在畫面上親自輸入。
- Dashboard 新增「建立預算版本草稿」表單（部門／年度選擇），呼叫既有的 `POST /api/budgets`。
- 修正 `TEST_BYPASS_USER`（SYSTEM_ADMIN 虛擬身分）原本缺少 `budget.edit_own_department` /
  `budget.submit_own_department` 能力、以及會寫入 `BudgetVersion.preparedById`／`submittedById` 這類
  User 外鍵而違反約束的問題（虛擬身分不寫入 User 資料表是既有設計，這兩個追蹤欄位現在比照稽核紀錄的作法
  寫為 `NULL`）。刻意**沒有**開放覆核／核准／退回／駁回／調整權限給此虛擬身分，職務分離內控與原設計完全
  一致，不因免登入模式而放寬。

### 本次更新：以財務管理處（17203）真實 62 筆明細科目取代 3 筆自建 DEMO 科目

上一版的 3 個 `DEMO-ACC-*` 一般費用測試科目已由**財務管理處（部門代碼 17203）實際使用的 62 筆明細費用科目**
取代，資料來源為使用者提供的 `2026年度費用預算V2--財務.xlsx`（工作表「財務」，B 欄「項目」＝科目名稱、F 欄
「2025推移」＝ 2025 參考金額）。變更內容：

- **新增 Prisma 欄位**：`Account.isProvisionalCode` / `sourceSeq` / `sourceRef` / `priorYearReferenceAmount`
  （暫用代碼標記、來源序號、來源說明、最近一次已知的前期參考金額）、`BudgetLine.justification`
  （說明／編列依據）。已建立對應 migration（`20260907133937_account_provisional_and_line_justification`）。
- **`src/lib/demo/constants.ts`**：改為財務管理處（17203）＋ 62 筆明細（科目代碼 `FIN-<Excel 原始序號補零>`，
  例如 `FIN-003`＝序 3「薪資支出」），依需求指定的四個分類區間歸類（人事費用／銷管費用／辦公費用／其他費用），
  **不含**「平均人數」「管理費用」及四大分類合計列 6 筆非科目資料列。預設測試年度改為 **2026**。
- **`seedDemoMasterData()`**：新增「舊版 DEMO 資料安全清理」——執行時會先偵測並**停用（絕不刪除）**舊版
  `DEMO-DEPT` 部門與 `DEMO-ACC-1/2/3` 科目（若存在），再 upsert 62 筆真實科目；冪等、可重複執行、只碰觸
  明確符合這些舊版代碼或本次 62 筆代碼的資料列，不影響任何其他資料。
- **`createBudgetVersionDraft()`**：新增科目若設有 `priorYearReferenceAmount`，建立預算列時會以此值同時
  帶入唯讀的「目標」與「推移」兩欄（並標記 `projectionIsComplete=true`），取代原本一律為 0／
  「資料不全，待確認」的預設值；2026 金額（`nextYearTargetExcludingNew`／`nextYearNewHireBudget`）
  仍固定從 0 起，須由使用者親自輸入，未預先帶入附件的 2026 數字。
- **`updateDepartmentInputLine()`**：新增可選的 `justification`（說明／編列依據）參數，與金額一同可由
  使用者編輯／保存；科目名稱、代碼、分類皆非使用者可修改欄位（後端從未提供對應寫入路徑）。
- **`src/lib/budget/categorySummary.ts`（新增）**：純函式，依科目 `commonCategory` 即時加總四大分類與
  管理費用總計，前後端共用（伺服器渲染初始值、瀏覽器端隨使用者編輯即時重算），不使用 Excel 原始合計數字。
- **預算輸入畫面（`BudgetVersionClient.tsx`）**：新增「分類」欄、暫用代碼徽章（含「待正式科目代碼確認」提示）、
  「2025推估金額（唯讀）」欄、「增減金額」欄、「說明／編列依據」欄，並在表格上方顯示四大分類＋管理費用合計
  （2026 即時計算 vs. 2025 參考，並列比較）。
- 一併沿用先前工作階段發現並修復的 `next.config.mjs` 開發模式 CSP 問題（`unsafe-eval` 僅開發環境放行，
  正式環境維持嚴格 CSP），否則本機 `next dev` 下前端 JavaScript 會完全無法執行。

**與 Excel 的核對結果**（`tests/demo-seed.test.ts` 自動驗證，亦於下方「操作方式」以真實 HTTP 請求覆核一次）：

| 項目 | 結果 |
|---|---|
| 明細科目筆數 | 62 筆（人事費用 17、銷管費用 15、辦公費用 14、其他費用 16，17+15+14+16=62） |
| 2025 推估金額總計（62 筆加總） | **22,176,065**，與來源檔案「管理費用」列（F 欄）原始合計數完全一致 |
| 四大分類 2025 小計 | 人事 11,186,397／銷管 2,379,612／辦公 9,319,760／其他 -709,704（「呆帳」為負值，屬合理的沖回／回收數字，非輸入錯誤） |

驗證結果（本次工作階段已具備完整網路與本機 PostgreSQL，如實回報）：

| 指令/項目 | 結果 |
|---|---|
| `npx prisma format` / `npx prisma validate` | ✅ 已實際執行，通過 |
| `npm run lint` | ✅ 0 錯誤、0 警告 |
| `npm run typecheck` | ✅ 無型別錯誤 |
| `npm test`（`vitest run`，全部測試檔） | ✅ **15 個測試檔、103 個測試，全數通過**（含改寫後的 `tests/demo-seed.test.ts` 19 項、新增 `tests/categorySummary.test.ts` 4 項） |
| `npm run build`（`next build`） | ✅ 成功產出 production build |
| 實際啟動 `next dev`（`VERCEL_ENV=preview`、`AUTH_DISABLED=true`）並以 HTTP 呼叫實際端點走完整流程 | ✅ 初始化 DEMO 主檔（62 筆，含重複呼叫驗證冪等）→ 建立 2026 年度預算版本 → 確認科目已帶入正確 2025 參考金額且 2026 金額為 0 → PATCH 修改一筆科目 2026 金額與說明 → 重新 GET 確認持久化（金額／說明／增減率皆正確）→ 送出審核成功 |

已知限制／待確認事項（見本文件最下方「需要決定或提供的業務資料」）：

1. 會計科目為全公司共用主檔（非按部門區分，既有架構限制，非本次引入）：若系統中已有其他 `FORMULA` 科目
   尚未設定公式，會一併出現在此 62 筆科目所屬的預算版本中並阻擋送出；本次驗證時即實際遇到並確認此行為
   正確（阻擋，而非默默略過）。
2. 「2025推估金額」目前同時寫入 `BudgetLine.priorYearOriginalBudget`（目標）與 `currentYearProjection`
   （推移）兩個欄位（同一數字），因為來源檔案本次僅提供單一參考欄（F欄「2025推移」），未提供獨立的
   「2025目標」數字；兩欄皆為唯讀展示，未讓使用者誤以為是兩個不同來源的數字。
3. 「2026預算金額」沿用既有的「目標(不含新員)／目標(新員)」兩欄結構（既有 11 欄格式的一部分），使用者可
   直接將 2026 總金額全數填入「不含新員」欄位、「新員」欄位留 0，畫面「合計」即等於單一輸入金額；若財務
   管理處日後需要拆分新進人員預算，此欄位已可直接使用。

### 本次修正：凍結明細表左側三欄／金額千分位／改用 Excel 序號為正式科目編號

延續上一版的財務管理處（17203）62 筆明細，依實際操作畫面回報修正三項：

- **凍結左側三欄（分類／科目編號／項目）**：`BudgetVersionClient.tsx` 的明細表改用 `position: sticky`
  固定這三欄的表頭與資料列（明確、互不重疊的欄寬與 `left` offset：84px／84px／176px，皆設不透明背景與
  `z-index`），第三欄右側加上陰影分隔線，並在「項目」欄對超長科目名稱加上 `truncate` 與 `title`
  屬性（滑鼠停留顯示完整名稱），使其不會蓋住右側金額欄。已在 1366／1440／1920 三種寬度以 Playwright
  實際驗證（頁面版面 `max-w-6xl` 使內容區固定約 1104px，三種寬度下明細表皆需水平捲動，凍結欄行為一致）。
- **金額千分位**：新增 `formatAmountInputValue()` / `sanitizeAmountInput()` / `parseAmountForSave()`
  三個輔助函式；「2026預算金額」「目標(新員)」輸入框改為 `type="text"` + `inputMode="decimal"`（不再用
  無法接受逗號的 `type="number"`），畫面顯示千分位、輸入/貼上時允許帶逗號、失焦儲存前才移除逗號與空白
  送出標準數字字串；儲存成功後立即以伺服器回傳值重新格式化顯示。原本已用 `formatAmount()` 千分位顯示的
  唯讀欄位（2025推估金額、合計(含新員)、增減金額、分類小計、管理費用合計）不受影響；原本遺漏的兩處唯讀
  金額顯示（公式科目/無編輯權限時的「目標(不含新員)」「目標(新員)」）一併補上千分位。金額精度全程沿用
  既有 `Decimal`／字串處理，未改用浮點數；後端既有的格式與負數驗證規則（`updateLineSchema` 正規表達式、
  `isNegative()` 檢查）未被繞過或放寬。
- **改用 Excel 來源科目編號**：移除暫用的 `FIN-<補零序號>` 代碼，`Account.code` 改為 Excel A欄「序號」
  原值（例如序 3 → 科目編號 `3`，序 39 → `39`），`Account.isProvisionalCode` 改為 `false`；畫面移除
  「暫用」徽章與「待正式會計科目代碼確認」提示。`seedDemoMasterData()` 的 upsert 改以新增的
  `Account.sourceSeq`（唯一索引，migration
  `20260908050000_account_source_seq_unique_code_migration`）為衝突鍵而非 `code` 本身——這樣才能讓
  `code` 本身被改寫而不流失既有列（保留 `Account.id`，不刪除重建，既有 `BudgetLine`／稽核紀錄／已送出
  的測試預算全數保留）；同一份 migration 另外以 SQL 直接把資料庫既有的 `FIN-<seq>` 列就地轉換成新代碼，
  兩者搭配可涵蓋「migration 尚未套用就先呼叫 API」與「migration 套用時直接轉檔」兩種升級路徑。新代碼與
  其他既有科目的 `code`（唯一鍵）衝突時，整批交易自動回滾並回傳清楚的繁體中文錯誤訊息（見
  `tests/demo-seed.test.ts` 新增的衝突／升級情境測試）。另修正一個因移除補零而浮現的排序問題：
  `dashboard/budgets/[id]/page.tsx`／`api/budgets/[id]/route.ts` 原本以 `account.code` 字串排序明細列，
  新代碼不補零時字串排序會錯亂（如 "10" 排在 "3" 之前），已改為以數值型的 `sourceSeq` 為主要排序鍵。
  62 筆明細與 2025 推估總額 22,176,065、四大分類小計均未變動。

**驗證結果**（本次工作階段具備完整網路與本機 PostgreSQL 16，`npm ci` → `npx prisma generate/format/validate`
→ `npm run lint` → `npm run typecheck` → `npm test` → `npm run build` 全數實際執行）：

| 指令 | 結果 |
|---|---|
| `npx prisma generate` / `format` / `validate` | ✅ 通過 |
| `npm run lint` | ✅ 0 錯誤、0 警告 |
| `npm run typecheck` | ✅ 無型別錯誤 |
| `npm test` | ✅ **16 個測試檔、120 個測試全數通過**（`tests/demo-seed.test.ts` 新增科目編號升級／衝突回滾情境） |
| `npm run build` | ✅ 成功產出 production build |
| 實際啟動 `next dev`（`AUTH_DISABLED=true`、`VERCEL_ENV=preview`）＋ Playwright 瀏覽器驗證 | ✅ 初始化主檔（62 筆，代碼 3～67，無 `FIN-` 前綴）→ 建立/開啟預算版本 → 明細表水平捲動時左側三欄固定、無文字重疊（1366/1440/1920px）→ 輸入 `1200000` 與貼上 `7,905,511.50`，失焦後分別顯示 `1,200,000`／`7,905,511.5`，資料庫精確存為 `1200000.00`／`7905511.50` → 重新整理後仍顯示千分位、數值不變 → 負數（`-500`）仍被拒絕並顯示錯誤 → 送出審核為 `SUBMITTED` 後重新執行主檔初始化，確認該版本狀態與金額、科目名稱/代碼皆未受影響 |

### 本次新增：部門人數（非會計科目）— 明細表第一列

在費用科目表格最上方新增一列固定的「部門人數」，2025 年（`priorYearHeadcount`，唯讀）／2026 年
（`budgetYearHeadcount`，可編輯）皆為 `BudgetVersion` 上的純量欄位，刻意**不是** Account／BudgetLine：
不出現在分類、科目編號、目標(新員)、增減金額、增減率或編列依據欄位，也絕不計入任何分類小計或管理費用
合計。

- **資料模型**：`BudgetVersion.priorYearHeadcount` / `budgetYearHeadcount`（`Int`，皆 `@default(0)`，不得為
  負數，服務層以正規表達式 `^\d{1,6}$` 驗證）；新增 `Department.priorYearHeadcount`（`Int?`，比照
  `Account.priorYearReferenceAmount` 的既有慣例：獨立於任何特定 `BudgetVersion` 的最近已知真實參考數字，
  從不虛構）。`seedDemoMasterData()` 將財務管理處（17203）的 `priorYearHeadcount` 設為 **10**（來源檔案
  序1「平均人數」，先前因非科目而排除於 `DEMO_ACCOUNTS` 之外，這次終於用上）；`createBudgetVersionDraft()`
  建立新草稿時，把該部門參考人數同時複製為 `priorYearHeadcount`（唯讀）與 `budgetYearHeadcount`
  （初始值，之後由使用者直接編輯）。因為 `budgetYearHeadcount` 存在每一筆 `BudgetVersion` 自己的欄位上，
  重新執行「初始化 DEMO 主檔」（只碰觸 `Department`／`Account`）**結構上就不可能**覆寫使用者已修改的人數。
  Migration `20260908060000_department_headcount` 為既有 `BudgetVersion` 資料列回填 10（避免顯示為 0）。
- **API**：新增 `PATCH /api/budgets/[id]/headcount`（`src/lib/budget/headcountService.ts`），只允許更新
  `budgetYearHeadcount`——`priorYearHeadcount` 全站沒有任何寫入路徑。沿用與 `updateDepartmentInputLine`
  完全相同的權限／部門範圍／工作流程狀態檢查（`budget.edit_own_department`、`requireDepartmentAccess`、
  `isEditable(status)`），已送出（`SUBMITTED`）或其他非可編輯狀態一律拒絕並回傳 409。成功時寫入
  `AuditLog`（`action: "BUDGET_HEADCOUNT_UPDATED"`，`beforeData`／`afterData` 皆含修改前後人數），Demo
  bypass 身分沿用既有的 `actorUserId` 為 `NULL` ＋ `[TEST_BYPASS_USER]` 標記規則。
- **畫面**（`BudgetVersionClient.tsx`）：新增 `HeadcountRow`，固定為 `<tbody>` 第一列（不受科目排序影響），
  淡色背景（indigo-50）＋粗體與下方科目列明顯區隔；水平捲動時「部門人數」隨凍結的「項目」欄一起固定，
  2025／2026 兩欄與其餘科目列的對應欄精確對齊。2026 欄位為 `type="text"` + `inputMode="numeric"`
  整數輸入框（僅接受 0 以上整數，逗號／小數點／負號／文字一律視為格式錯誤，不像金額欄位那樣靜默移除逗號），
  失焦即呼叫上述 API 自動儲存；儲存失敗時顯示明確錯誤訊息並**恢復為儲存前的原值**（與金額欄位「保留使用者
  輸入原文供修正」的行為刻意不同，依本次需求規格）。

**驗證結果**：`npm test` 新增 `tests/headcount.test.ts`（14 項，涵蓋草稿預設值、10→12 修改與 AuditLog、
負數／小數／文字／空字串／逗號／超出上限的拒絕、`SUBMITTED` 不可修改、不建立 Account/BudgetLine、重新
初始化 DEMO 主檔後使用者輸入不被覆寫）；`npm run build` 成功；實際啟動 `next dev` 並以 Playwright 完成
建立草稿（首列顯示 10/10）→ 2026 改為 12 →失焦儲存 →重新整理仍為 12 →分類小計/管理費用合計不變 →送出
預算 →送出後嘗試修改被拒絕（409）且畫面/資料庫皆仍為 12。

### 本次新增：撤回修改（SUBMITTED → DRAFT）＋ 最後一次編製日期

**撤回修改**：`SUBMITTED` 版本新增「撤回修改」——不必等財務退回，原編製部門可自行把版本拉回 `DRAFT`
繼續修改、再重新送出。

- **狀態機**（`lib/workflow/stateMachine.ts`）：新增 `withdraw` action，僅定義
  `{ from: "SUBMITTED", action: "withdraw", to: "DRAFT" }` 一條規則；其餘狀態（`UNDER_REVIEW`／
  `LOCKED`／`ADJUSTED`／`REJECTED`…）一律不匹配，一如既有的其他非法轉換。
- **`withdrawBudgetSubmission()`**（`lib/workflow/actions.ts`，新增）：權限比照 `updateDepartmentInputLine`
  ——`budget.edit_own_department` ＋ `requireDepartmentAccess`（僅原編製部門的編製權限者可撤回，
  `TEST_BYPASS_USER` 在 Preview 已內建此能力）；若已進入 `UNDER_REVIEW`，回傳更明確的 409：
  「預算已進入審核程序，無法自行撤回，請由審核人員退回修改。」而非泛用的狀態轉換錯誤。只改
  `status` 欄位，**不刪除或重建**任何 `BudgetVersion`／`BudgetLine`，金額、部門人數、編列依據、
  `versionNumber` 全數原封不動。成功時寫入 `AuditLog`（`action: "BUDGET_SUBMISSION_WITHDRAWN"`，
  `beforeData/afterData` 記錄狀態轉換，Demo bypass 身分沿用既有 `actorUserId=NULL` ＋ 標記規則）。
- **API**：新增 `POST /api/budgets/[id]/withdraw`。
- **畫面**：`SUBMITTED` 頁面在狀態列下方顯示「撤回修改」按鈕（琥珀色、與藍色「送出申請」明顯區隔），
  點擊後顯示內嵌確認區塊（「確定要撤回此預算並重新修改嗎？撤回後需再次送出申請。」），確認後呼叫 API
  並 `router.refresh()` 原地重新載入（不導回 Dashboard），畫面立即顯示 `DRAFT` 與可編輯輸入框。

**最後一次編製日期**：新增 `BudgetVersion.lastPreparedAt`（`DateTime`，UTC 儲存），標題／狀態下方顯示
「最後一次編製日期：YYYY.MM.DD」（`Asia/Taipei` 時區），Dashboard 版本清單同步新增「最後編製日期」欄。

- 刻意不用 `updatedAt`——狀態轉換（送出、撤回、覆核、核准…）也會更新 `updatedAt`，無法代表「使用者最後
  一次真正修改內容」的時間；`lastPreparedAt` 只在 2026 金額／目標(新員)／編列依據（`updateDepartmentInputLine`）
  或 2026 部門人數（`updateBudgetYearHeadcount`）**實際寫入的值與原值不同**時才更新（以 `Decimal.equals()`／
  數值比較判斷，重複送出相同值不動）；建立草稿（`createBudgetVersionDraft`）與調整申請
  （`requestAdjustment`）建立子版本時各自設定一次；僅檢視、撤回、送出／重新送出一律不觸碰。
  每次寫入都在同一個既有的小型互動交易內多加一句 `UPDATE`（不引入逐筆迴圈），沿用既有「固定少量 SQL、
  避免 Neon P2028」的作法；多人同時編輯不同明細時，就是資料庫層面單純的「最後寫入者為準」，無需額外鎖定。
- 新增共用格式化函式 `lib/format/date.ts#formatTaipeiDate()`（`Intl.DateTimeFormat` 以 `en-CA` 取得
  `YYYY-MM-DD` 再轉點分隔），前後端（Client Component 與 Server Component）共用同一實作。
- **Migration**（`20260908070000_budget_version_last_prepared_at`）：先新增可為 NULL 的欄位，再以
  SQL 回填每一筆既有 `BudgetVersion`——優先取該版本「最後一筆內容修改」的 AuditLog 時間（`BUDGET_HEADCOUNT_UPDATED`
  直接以 `entityId` 對應；`BUDGET_LINE_UPDATED` 的 `entityId` 是 `BudgetLine.id`，需先 JOIN 回其
  `budgetVersionId`），找不到任何內容修改紀錄的版本（例如建立後從未編輯過的草稿）才 `COALESCE` 退回
  `updatedAt`，最後才收緊為 `NOT NULL`。已於本機 dev 資料庫（含本次工作階段累積的真實測試資料）實際
  套用並人工核對：`SUBMITTED` 版本的回填值精確落在「送出前最後一次編輯」的時間點，而非送出動作本身
  的時間，證實此回填邏輯確實達到「非 `updatedAt`」的設計目的。

**驗證結果**：新增 `tests/withdraw.test.ts`（9 項）與 `tests/lastPreparedAt.test.ts`（11 項），共 20 項，
涵蓋合法撤回、撤回後資料完整保留、撤回後可修改並重新送出、`UNDER_REVIEW`／`DRAFT` 不可撤回、無權限者
不可撤回、`AuditLog` 完整性、Preview bypass 完整撤回流程、新草稿設定 `lastPreparedAt`、金額/新員/說明/
部門人數變更觸發更新、僅檢視/撤回/送出不觸發、寫入相同值不觸發、`Asia/Taipei` 格式化、以及撤回與編輯
過程不新增/刪除/重複 `BudgetLine`；`npm run build` 成功；已在全新資料庫與已套用既有 migration 的升級
資料庫上分別執行 `prisma migrate deploy`（皆成功，後者為 no-op 確認冪等）；實際啟動 `next dev` 並以
Playwright 完成：開啟 `SUBMITTED` 預算 →確認顯示最後編製日期與撤回按鈕 →撤回（狀態變 `DRAFT`，欄位變
可編輯）→修改一筆金額與部門人數 →重新整理仍保留 →最後編製日期正確更新 →再次送出（`SUBMITTED`）→送出
後欄位恢復唯讀 →直接查詢資料庫確認 `AuditLog` 完整記錄「建立→送出→撤回→人數修改→再次送出」全流程。

## 部署文件

- [`VERCEL_DEPLOYMENT.md`](VERCEL_DEPLOYMENT.md) — Vercel 環境變數、build 設定、回滾、migration 失敗處理
- [`NEON_SETUP.md`](NEON_SETUP.md) — Neon 專案建立、pooled/direct 連線字串、Preview 資料庫分支
- [`SECURITY.md`](SECURITY.md) — 已實作的資安控制、SSO/MFA 整合說明與限制
- [`OPERATIONS.md`](OPERATIONS.md) — 管理員 bootstrap、主檔匯入流程、備份還原演練
- [`.github/workflows/migrate.yml`](.github/workflows/migrate.yml) — 手動觸發的正式 migration workflow

## 需求追溯表

完整的需求編號、來源、對應功能、對應程式檔案、測試方式、狀態、P0 標記與尚待確認事項，見
[`docs/requirements-traceability.md`](docs/requirements-traceability.md)。

## 是否具備正式上線條件：誠實結論

**尚未完全具備**。核心應用程式架構、狀態機、權限控管、稽核軌跡、Decimal 金額計算、Excel 匯入匯出、業務記憶
機制、部署管線設定皆已完成並通過實際測試（見上表）。但正式上線前仍有以下**必須由人工/業務單位完成**的事項
（詳見 `docs/requirements-traceability.md` 最末「P0 上線阻擋項目」）：

1. 尚未建立真實 Neon Production/Preview 資料庫並完成連線設定（本次工作階段依指示未接觸正式 Neon 資料庫）。
2. 尚未匯入真實的 239 筆會計科目、真實部門主管/財務覆核/核准人員名單（v0.4 規格書中對應資料為模擬或
   待確認，依指示不可虛構代入）。
3. 密碼重設信件尚未串接真實 Email 寄送服務。
4. 若公司要求 MFA/SSO 才能上線，尚未實作（依指示不做假功能，已列為阻擋項目並提供整合建議）。
5. 海外據點部門的四大類歸屬（v0.4 §6）尚待財務團隊確認。
6. **Preview 免登入 Demo 模式相關 P0 檢查**（見 `SECURITY.md`／`VERCEL_DEPLOYMENT.md` 第 9 節）：上線前
   須確認 Vercel Production 環境變數沒有殘留 `AUTH_DISABLED=true`；`tests/auth-bypass-db.test.ts`
   （需資料庫的稽核紀錄/虛擬身分驗證）尚未在具備完整網路權限的環境執行過，應於下一階段補上。

## 授權

內部系統，僅供公司內部使用。
