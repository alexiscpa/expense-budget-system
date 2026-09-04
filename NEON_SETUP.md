# Neon PostgreSQL 設定指南

本系統的正式資料庫使用 [Neon](https://neon.tech) PostgreSQL。本文件說明如何建立專案、取得連線字串，以及如何用 Neon
的資料庫分支（branching）功能讓 Preview 部署不會誤用正式資料。

## 1. 建立 Neon Production 專案

1. 登入 [Neon Console](https://console.neon.tech)，建立新 Project（例如命名為 `expense-budget-system`）。
2. 選擇離 Vercel 部署區域最近的 region（例如與 Vercel 專案相同區域，降低延遲）。
3. Neon 會自動建立一個預設分支（通常叫 `main` 或 `production`），這就是正式資料庫。

## 2. 取得 Pooled 與 Direct 連線字串

在 Neon Console 的專案頁面點選 **Connect**：

- **Pooled connection**（給應用程式執行期使用，走 PgBouncer）：
  勾選 "Pooled connection"，字串類似：
  ```
  postgresql://USER:PASSWORD@ep-xxxx-pooler.REGION.aws.neon.tech/DBNAME?sslmode=require&pgbouncer=true
  ```
  這個字串設定給 `DATABASE_URL`。**注意主機名稱中的 `-pooler` 後綴**，這是 PgBouncer 端點的標記。

- **Direct connection**（給 Prisma Migrate 使用，不能走連線池）：
  取消勾選 "Pooled connection"，字串類似：
  ```
  postgresql://USER:PASSWORD@ep-xxxx.REGION.aws.neon.tech/DBNAME?sslmode=require
  ```
  這個字串設定給 `DIRECT_URL`。

為什麼需要兩組字串：`prisma/schema.prisma` 的 `datasource db` 區塊同時宣告了 `url`（給執行期 Prisma Client 用，
走 pooled 連線避免 Vercel Serverless Function 造成連線數暴增）與 `directUrl`（Prisma Migrate 系列指令會自動改用
這個，因為 schema migration 需要 session-level 的直連，PgBouncer 的 transaction pooling 模式不支援）。

## 3. Preview 部署與 Neon 資料庫分支（branching）— 避免誤用正式資料庫

**絕對不要**讓 Vercel 的 Preview 部署使用與 Production 相同的 `DATABASE_URL`／`DIRECT_URL`。Neon 的分支功能可以
為每個 Preview（甚至每個 PR）建立獨立、隔離的資料庫副本：

### 作法 A：Neon 官方 Vercel 整合（建議）

1. 在 Vercel 專案的 Integrations 頁面加入 **Neon** 整合。
2. 啟用後，Neon 會在每次建立 Vercel Preview Deployment 時，自動從 Production 分支建立一個**臨時資料庫分支**，
   並自動把該分支的 `DATABASE_URL`／`DIRECT_URL` 注入到該次 Preview 部署的環境變數（Scope 設為 Preview）。
3. Preview 部署結束（PR 關閉/合併）後，Neon 會依設定自動刪除該臨時分支，不會殘留資料，也不會動到正式資料。

### 作法 B：手動建立固定的 Preview 分支

1. 在 Neon Console 建立一個名為 `preview` 的分支（Branches → Create branch，從 `production` 分支建立）。
2. 取得該 `preview` 分支各自的 pooled/direct 連線字串。
3. 在 Vercel 專案設定 → Environment Variables，將 `DATABASE_URL`／`DIRECT_URL` 的 **Preview** 環境（與
   Production 環境分開設定）指向這組 `preview` 分支字串。
4. 缺點：所有 Preview 部署共用同一個分支資料，彼此可能互相污染測試資料；適合團隊人數少、Preview 需求簡單的情境。
   人數較多或需要嚴格隔離時，建議採用作法 A。

無論哪種作法，**核心原則**：Vercel 環境變數必須依 Environment（Production / Preview / Development）分別設定，
且 Preview 對應的連線字串永遠不可指向 Production 分支。詳見 `VERCEL_DEPLOYMENT.md`。

## 4. 執行 Migration

Migration **不會**在 Vercel build 時自動執行（見 `VERCEL_DEPLOYMENT.md`）。正式環境的 schema 變更一律透過
`.github/workflows/migrate.yml`（手動觸發的 GitHub Actions）執行：

```bash
npx prisma migrate deploy
```

此指令會依 `prisma/schema.prisma` 中的 `directUrl` 設定，自動改用 direct 連線執行 migration，不會透過連線池。

## 5. 連線數與 Serverless 注意事項

Neon 的免費/入門方案對併發連線數有限制。Vercel Serverless Functions 每個執行實例可能各自建立資料庫連線，若
使用 direct 連線容易迅速耗盡連線數上限。這也是為什麼應用程式執行期（`src/lib/prisma.ts` 的 `PrismaClient`）
**必須**使用 pooled 連線字串（`DATABASE_URL`），並在同一個 Node.js 執行環境中重複使用同一個 `PrismaClient`
實例（見程式碼中的 `global.__prisma` 快取寫法）。

## 6. 備份與還原

Neon 內建 **Point-in-Time Restore (PITR)**，可將分支還原到過去某個時間點（依方案而定，通常保留數小時至數天）。
定期演練方式與操作步驟請見 `OPERATIONS.md` 的「備份與還原演練」章節。
