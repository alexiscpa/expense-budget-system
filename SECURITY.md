# 資安說明（SECURITY.md）

本文件說明本系統已實作的資安控制、已知限制，以及正式上線前必須解決的阻擋項目。

## 已實作的控制

| 項目 | 實作方式 | 程式位置 |
|---|---|---|
| 密碼雜湊 | bcrypt，cost factor 12 | `src/lib/auth/password.ts` |
| 密碼強度政策 | 至少 12 碼、需含大小寫字母、數字、特殊符號，後端強制檢查 | `src/lib/auth/password.ts` (`checkPasswordPolicy`) |
| 登入錯誤訊息 | 帳號不存在／密碼錯誤／帳號鎖定，一律回傳相同通用訊息，避免帳號列舉 | `src/app/api/auth/login/route.ts` |
| 登入失敗鎖定 | 連續 5 次失敗鎖定 15 分鐘，所有嘗試記錄於 `LoginAttempt` | `src/lib/auth/rateLimit.ts` |
| 密碼重設 | 隨機 token 以 SHA-256 雜湊後儲存、30 分鐘過期、一次性使用；回應訊息不透露帳號是否存在 | `src/app/api/auth/password-reset/*` |
| Session/Cookie | JWT（HS256）簽署、`httpOnly`、正式環境強制 `secure`、`SameSite=Lax`、8 小時效期 | `src/lib/auth/session.ts` |
| 輸入驗證 | 所有 API 路由以 zod schema 驗證請求內容 | `src/lib/validation/schemas.ts` |
| SQL Injection 防護 | 全面透過 Prisma 參數化查詢，未使用任何字串拼接 SQL | 全專案 |
| XSS 防護 | React 預設自動跳脫輸出，未使用 `dangerouslySetInnerHTML` | 全專案 |
| CSRF 防護 | 所有會變更狀態的 API（POST/PATCH/DELETE）皆檢查 `Origin`/`Host` 是否同源；Session cookie 另有 `SameSite=Lax` 作為第二層防護 | `src/lib/security/csrf.ts` |
| IDOR 防護 | 所有查詢/操作皆以後端 `requireDepartmentAccess`／`getAccessibleDepartmentIds` 決定可視範圍，不信任前端傳入的 `departmentId` | `src/lib/rbac/*` |
| 正式環境錯誤處理 | 一律回傳通用錯誤訊息（`errorResponse`），不對外洩漏堆疊追蹤或資料庫錯誤細節；細節僅寫入伺服器端 `console.error` | `src/lib/rbac/guard.ts` |
| 安全 Headers | CSP、HSTS、X-Frame-Options: DENY、X-Content-Type-Options: nosniff、Referrer-Policy 等 | `next.config.mjs` |
| Excel 公式注入防護 | 匯出時對危險前綴字元（`=`、`+`、`-`、`@`）加註escape；匯入時拒絕含公式的儲存格 | `src/lib/excel/sanitize.ts` |
| 稽核紀錄不可竄改 | `AuditLog` 沒有任何 API 提供 update/delete；`tests/audit.test.ts` 以掃描全部 API route 原始碼的方式驗證此不變性 | `src/lib/audit/log.ts` |

## SSO / MFA 整合說明（正式上線阻擋項目，尚未實作）

依開發指令明確指示：「如果現階段無法安全完成 MFA 或 SSO，請不要做假的功能；列為正式上線阻擋項目」。因此本專案
**刻意不實作**任何看起來像 MFA/SSO 但實際無效的功能。目前狀態：

- `User` 資料表已保留 `ssoSubject`（唯一索引，供未來 SSO IdP 的使用者識別碼對應）與 `mfaEnabled` 欄位，
  作為未來整合的資料模型基礎，但**目前沒有任何程式邏輯使用這兩個欄位**。
- 目前唯一的登入方式是 email + password（見「已實作的控制」）。

**若公司要求正式上線前必須具備 SSO 或 MFA**，後續整合建議路徑：

1. **SSO（企業單一登入）**：建議整合支援 OIDC/SAML 的身分提供者（如 Azure AD / Entra ID、Okta、Google
   Workspace）。作法上可採用 `next-auth`（Auth.js）的 OIDC provider，或直接以 `openid-client` 套件手動實作
   授權碼流程；登入成功後以 `ssoSubject` 對應既有 `User` 記錄（或依政策自動建立新使用者並套用預設
   `READ_ONLY` 角色，待管理員手動指派實際角色，不可由 SSO 回傳的任何欄位自行決定角色）。
2. **MFA（多因子驗證）**：建議採用 TOTP（如 `otplib`）或整合企業既有的 MFA 機制（若 SSO IdP 本身已要求
   MFA，可能不需要應用層另外實作）。若自行實作 TOTP，需在 `User` 增加加密儲存的 secret 欄位、備援復原碼
   機制，並在登入流程中插入第二階段驗證步驟。
3. 兩者皆完成後，才可將 `mfaEnabled` 實際用於強制要求特定角色（例如 `FINANCE_APPROVER`、`SYSTEM_ADMIN`）
   必須啟用 MFA 才能核准/管理。

## 已知限制（需於正式上線前評估）

1. **密碼重設信件尚未串接真實 Email 服務**：目前 `/api/auth/password-reset/request` 僅在非正式環境
   （`NODE_ENV !== "production"`）的 API 回應中回傳 reset token 供開發測試；正式環境不會回傳 token，但也
   **沒有任何管道把 token 送達使用者**，因此正式上線前必須串接 Email 服務（如 Resend、SendGrid、AWS SES）。
2. **無自動異常金額告警門檻**：因規格書未提供具體的百分比或金額門檻，系統未自行假設業務規則去攔截「異常金額」；
   核准與否本就一律需要真人手動執行（系統中沒有任何自動核准路徑），已符合「異常金額不得自動核准」的最低要求，
   但尚未提供更進一步的視覺化異常警示，建議財務單位提供具體門檻後再實作。
3. **速率限制目前僅涵蓋登入**：其他高流量 API（如匯入、匯出）尚未加上額外的請求頻率限制，正式上線前建議於
   Vercel 邊緣層或應用層加上通用的 rate limiting（例如 Vercel 的 Edge Middleware + Upstash Ratelimit）。

## 回報安全問題

若在程式碼審查或滲透測試中發現安全問題，請勿直接開公開 Issue 揭露細節，應透過內部安全通報管道回報。
