# Vercel 部署指南

## 1. 專案設定

- Framework Preset: **Next.js**（Vercel 會自動偵測，`vercel.json` 中也明確宣告 `"framework": "nextjs"`）
- Install Command: `npm ci`
- Build Command: `npm run build`（即 `next build`，**不含**任何 `prisma migrate` 或 seed 指令）
- Output Directory: `.next`
- Node.js 版本：建議與 `package.json` 的 `engines.node`（`>=20.0.0`）一致，於 Vercel 專案設定選擇 Node 20.x

`package.json` 的 `postinstall` 會執行 `prisma generate`（只讀取 `prisma/schema.prisma` 產生 TypeScript
Client 型別，**不會連線資料庫、不會執行 migration**），這是 Prisma 官方建議的標準做法，確保 build 階段能拿到
正確的 Prisma Client 型別。

## 2. 環境變數設定（Vercel Project Settings → Environment Variables）

依 Environment（**Production** / **Preview** / **Development**）分別設定以下變數。**Production 與 Preview
必須指向不同的 Neon 資料庫分支**（見 `NEON_SETUP.md` 第 3 節），避免 Preview 部署誤用或污染正式資料。

| 變數 | Production | Preview | 說明 |
|---|---|---|---|
| `DATABASE_URL` | Neon `production` 分支的 pooled 連線字串 | Neon `preview` 分支（或 Neon-Vercel 整合自動注入）的 pooled 連線字串 | 應用程式執行期使用 |
| `DIRECT_URL` | Neon `production` 分支的 direct 連線字串 | Neon `preview` 分支的 direct 連線字串 | 僅 Prisma Migrate 使用；Vercel build 不會用到，但仍須設定以通過 `prisma generate`／未來若在 build 中呼叫到 Prisma CLI 驗證 schema 時不出錯 |
| `SESSION_SECRET` | 一組僅用於 Production 的高強度隨機值（`openssl rand -base64 48`） | 一組僅用於 Preview 的隨機值（不可與 Production 相同） | 簽署 session cookie 的密鑰，切勿共用 |
| `NODE_ENV` | `production`（Vercel 預設會自動注入，通常不需手動設定） | 同上 | - |
| `APP_BASE_URL` | 正式網域，例如 `https://budget.example.com` | 該次 Preview 的網址（Vercel 會提供 `VERCEL_URL`，可視需要於程式中組合） | 用於信件連結等絕對網址 |
| `AUTH_DISABLED` | **不要設定**（或設為 `false`） | `true`（僅在需要 Demo 免登入測試模式時設定） | 見第 9 節，Production 即使誤設也不會生效 |

所有變數皆透過 Vercel 後台或 `vercel env` CLI 設定，**絕不**寫入任何會被提交到 Git 的檔案（`.env`／
`.env.local` 已列在 `.gitignore`）。

## 3. Migration 不在 Vercel Build 階段執行

`package.json` 的 `build` script 明確只執行 `next build`。**正式資料庫 schema 變更一律透過
`.github/workflows/migrate.yml` 手動觸發**（見下方第 5 節與 `NEON_SETUP.md`）。這樣設計的原因：

- 避免多個並行的 Vercel build（例如同時有多個 PR 觸發 Preview build）同時嘗試對同一個資料庫執行 migration，
  造成 migration lock 衝突或部分套用的風險。
- 讓 schema 變更成為一個**明確、需要人工觸發、可審核**的步驟，而不是每次部署程式碼就順帶悄悄改資料庫。
- 符合本專案「不得在 Vercel build 階段自動執行 migration／不得自動執行 seed」的內控要求。

## 4. 正式部署流程

1. 程式碼合併進主分支（或依團隊流程開 PR → Vercel 自動建立 Preview）。
2. 若本次變更包含 Prisma schema 異動，**先**手動觸發 `.github/workflows/migrate.yml`
   （GitHub → Actions → "Deploy Database Migrations" → Run workflow → 選擇 `production`），確認 migration
   成功後，再進行下一步。
3. 於 Vercel 觸發 Production 部署（合併進主分支通常會自動觸發；也可於 Vercel 後台手動 Redeploy）。
4. 部署完成後，呼叫 `/api/health` 驗證（見第 6 節）。

## 5. GitHub Actions Migration Workflow

見 `.github/workflows/migrate.yml`。此 workflow：

- 觸發方式：**僅** `workflow_dispatch`（手動觸發，需選擇目標 environment：`production` 或 `preview`），
  **不會**在 push 或排程時自動執行。
- 需要在 GitHub 專案的 **Settings → Environments** 建立對應的 `production` / `preview` Environment，並在該
  Environment 底下設定 Secrets：`DATABASE_URL`、`DIRECT_URL`（值取自 Neon Console，見 `NEON_SETUP.md`）。
  建議為 `production` Environment 加上 Required reviewers，強制至少一位額外人員核准後才能實際執行，作為
  高風險操作的第二層控管。
- 執行內容：`npm ci` → `npx prisma migrate deploy` → `npx prisma migrate status`（驗證套用結果）。

## 6. 驗證 `/api/health`

部署完成後：

```bash
curl -s https://<your-domain>/api/health
```

預期回應（HTTP 200）：

```json
{
  "status": "ok",
  "app": "ok",
  "database": "ok",
  "dbLatencyMs": 12,
  "timestamp": "2026-xx-xxT00:00:00.000Z"
}
```

若資料庫無法連線，回應會是 HTTP 503，`"status": "degraded"`、`"database": "unreachable"`，且**不會**包含任何
資料庫錯誤訊息或堆疊追蹤（見 `src/lib/health/check.ts` 與 `tests/health.test.ts`）。建議將此端點接入外部
uptime 監控服務（如 UptimeRobot、Better Uptime、Vercel 自帶的 Monitoring）。

## 7. 回滾應用程式的方法

Vercel 保留每次部署的完整歷史記錄：

1. 前往 Vercel 專案 → **Deployments**，找到先前正常運作的部署。
2. 點選該部署的選單 → **Promote to Production**（或稱 "Redeploy"），即可將 Production 流量切回該版本，
   幾乎是瞬時生效（Vercel 是以不可變部署 + 路由切換的方式運作，不需要重新 build）。
3. **注意**：應用程式回滾**不會**自動回滾資料庫 schema。若該次上線同時包含 migration，回滾程式碼前務必評估
   新舊程式碼與資料庫 schema 的相容性（理想上 migration 應保持向後相容，讓回滾一版程式碼仍可運作於新
   schema）。若 migration 本身有問題，見第 8 節。

## 8. 資料庫 Migration 失敗時的處理方式

1. GitHub Actions 的 `migrate.yml` 執行失敗時，工作流程本身會直接失敗並顯示錯誤（`npx prisma migrate deploy`
   的輸出），不會有「部分套用又假裝成功」的情況。
2. 先執行 `npx prisma migrate status`（可在本機或 Actions log 中查看）確認目前套用到哪個 migration、是否有
   `Failed migrations` 記錄。
3. 若某個 migration 檔案本身有誤（例如 SQL 語法錯誤、與現有資料衝突），**不要**直接修改已提交的 migration
   檔案內容（Prisma 是以檔名+checksum 追蹤 migration 是否變更過，事後修改會造成團隊間不一致）。應：
   - 撰寫一個新的 migration 來修正問題（`prisma migrate dev --name fix_xxx` 於本機／測試環境先驗證），或
   - 若該 migration 尚未在任何環境套用成功，才可以刪除重建。
4. 若 migration 在 Neon 上卡在「部分套用」狀態，可用 `npx prisma migrate resolve --applied <migration_name>`
   或 `--rolled-back <migration_name>` 手動標記該筆 migration 的狀態（依實際資料庫現況判斷是否已真的套用），
   此為**破壞性判斷操作**，執行前務必先以 `psql` 或 Neon Console 檢查資料庫目前的實際結構，並知會團隊。
5. 修正後重新執行 workflow，並再次以 `npx prisma migrate status` 確認一致。

## 9. Demo 測試環境（Preview 專用免登入模式）— P0 上線阻擋項目

系統支援一個**僅限 Preview 部署**使用的免登入 Demo 模式，用途是讓非工程人員在 PR/分支的 Preview 網址上快速
點閱系統功能，不需要建立測試帳號密碼。**此設定列為 P0 上線阻擋項目**：每次正式上線前必須確認 Production
環境變數中沒有殘留 `AUTH_DISABLED=true`。判斷邏輯集中於 `src/lib/env.ts` 的 `isAuthBypassEnabled()`：

```
若 VERCEL_ENV === "production"        → 一律關閉（無論 AUTH_DISABLED 為何，無法覆蓋）
否則若 AUTH_DISABLED !== "true"        → 關閉
否則（AUTH_DISABLED === "true"）       → 僅當 VERCEL_ENV === "preview" 時才開啟
```

**啟用方式**：僅在 Vercel Project Settings → Environment Variables 的 **Preview** 分頁新增
`AUTH_DISABLED=true`。**絕對不要**在 **Production** 分頁設定此變數——即使誤設，程式邏輯也會忽略它，
但仍應避免造成混淆，且應定期檢查 Production 環境變數清單中沒有殘留此設定。**本系統不存在名為
`ALLOW_PRODUCTION_AUTH_BYPASS` 或任何其他名稱的第二開關**——Production 的免登入判斷沒有任何覆蓋機制，
這是刻意的設計決策，避免日後有人以為多設一個環境變數就能在正式環境繞過登入。

**啟用後的行為**：
- 免登入，自動以虛擬「測試管理員」（`TEST_BYPASS_USER`）身分進入系統，此身分**不對應任何資料庫使用者**，
  未使用任何預設密碼，也不會因啟用此模式而觸發 `prisma db seed`。
- 網站頂端固定顯示紅色提示列「Demo 測試環境，禁止輸入正式資料」。
- `/login` 顯示「目前已啟用 Demo 測試環境免登入模式」與返回首頁按鈕，不出現帳密輸入表單。
- 所有稽核紀錄（`AuditLog`）的 `actorUserId` 一律寫入 `NULL`（不會冒充任何真實使用者 id），並在
  `reason` 欄位標記 `[TEST_BYPASS_USER]`，方便日後查核哪些資料列來自 Demo 測試操作。

**上線前必移除／必檢查項目**：
- Vercel **Production** 環境變數中不得出現 `AUTH_DISABLED=true`（正常情況下即使出現也不會生效，但仍列為
  上線檢查清單項目，避免組態混亂）。
- Preview 環境變數的 `DATABASE_URL` / `DIRECT_URL` **必須**指向 Neon 的測試/預覽分支，**絕不可**指向
  Production 分支（見第 2 節環境變數表格與 `NEON_SETUP.md` 第 3 節）。建議直接啟用 Neon 官方的
  Vercel 整合「Automatically create a database branch for each preview deployment」，讓每次 Preview
  都拿到一個全新、互相隔離、與 Production 完全無關的 Neon 分支，從架構上避免免登入模式誤觸正式資料。
- 因為 Demo 身分等同 `SYSTEM_ADMIN` 且不受帳密保護，Preview 網址應視同**公開可寫入的測試環境**，不得
  存放任何真實部門、真實員工或真實財務數字（無論是否啟用 `AUTH_DISABLED`，Preview 資料庫都不應含真實資料）。
