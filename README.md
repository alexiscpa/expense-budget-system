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

驗證結果（本次工作階段已具備完整網路與本機 PostgreSQL，如實回報）：

| 指令/項目 | 結果 |
|---|---|
| `npx prisma format` / `npx prisma validate` | ✅ 已實際執行，通過 |
| `npm run lint` | ✅ 0 錯誤、0 警告 |
| `npm run typecheck` | ✅ 無型別錯誤 |
| `npm test`（`vitest run`，全部測試檔） | ✅ **14 個測試檔、93 個測試，全數通過**（含新增 `tests/demo-seed.test.ts` 13 項） |
| `npm run build`（`next build`） | ✅ 成功產出 production build |
| 實際啟動 `next dev`（`VERCEL_ENV=preview`、`AUTH_DISABLED=true`）並以 HTTP 呼叫實際端點走完整流程 | ✅ 初始化 DEMO 主檔（含重複呼叫驗證冪等）→ 建立預算版本 → 修改科目金額 → 重新讀取確認持久化 → 送出審核，全部成功；稽核紀錄逐筆確認 `actorUserId` 為 `NULL` 且 `reason` 含 `[TEST_BYPASS_USER]` |

已知限制（既有架構，非本次引入）：會計科目為全公司共用主檔（非按部門區分），建立 DEMO 預算版本時會套用當下
系統中所有作用中科目；若系統已有其他 `FORMULA` 科目尚未設定公式，會一併出現在 DEMO 預算版本中並阻擋送出。

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
