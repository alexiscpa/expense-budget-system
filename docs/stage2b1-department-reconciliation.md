# Stage 2B-1：全公司預算編製單位盤點（唯讀）

版本：v1.3（人工追加裁決：12501 確定停用，見版本紀錄）

## 版本紀錄

| 版本 | 內容 |
|---|---|
| v1.0 | 初版，68 筆逐部門盤點；BUDGET_OWNER 45、PARENT_ONLY 13、MERGED 1、INACTIVE 4、NEEDS_CONFIRMATION 5 |
| v1.1 | 人工已明確確認 `12331`／`12401`／`12501`／`13001`／`14001` 五筆皆為上層彙總單位、非預算編製單位，全數由 NEEDS_CONFIRMATION 改列 PARENT_ONLY（統一 exclusionReason：「人工確認為上層彙總單位，不建立預算輸入表，不列入預算編製進度分母。」）；BUDGET_OWNER 維持45、PARENT_ONLY 增為18、NEEDS_CONFIRMATION 歸零；原始調查證據（出現位置、明細頁、公式）全數保留於各自條目，未刪除任何部門紀錄；本輪僅更新本文件與 `docs/data/stage2b1-department-manifest.{json,csv}`，未修改 `src/`／`prisma/`／任何資料庫 |
| v1.2 | 人工發現 v1.1 對 `12331`／`12401` 的裁決有誤，重新裁決：`12331`（海外行銷部）原始 ERP 名稱明確標示「無」，應為 **INACTIVE**（非 PARENT_ONLY），exclusionReason 改為「原始 ERP 部門名稱明確標示「無」，不建立預算輸入表，不列入進度分母。」；`12401`（營業企劃處）維持 PARENT_ONLY，但 exclusionReason 更新為具體理由「上層彙總單位，下屬12411成品企劃部及12421客戶服務部分別編製預算。」；另補上 `16104`（台灣廠，v1.0 起即為 PARENT_ONLY、未被 v1.1 觸碰）的 exclusionReason 註記，未變更其 disposition、不重複計數；`A0004`（蘇州廠）經人工再次確認**維持 BUDGET_OWNER 不變**（有專屬明細頁與真實 2025 數字，非上層彙總單位，本輪未觸碰）；`12501`／`13001`／`14001` 維持 v1.1 的 PARENT_ONLY 判斷不變。BUDGET_OWNER 維持 45、PARENT_ONLY 由 18 降為 17、INACTIVE 由 4 增為 5、NEEDS_CONFIRMATION 維持 0；原始調查證據全數保留，未刪除任何部門紀錄 |
| v1.3 | 人工追加裁決：`12501`（教研營業處）確定從系統部門名冊停用，disposition 由 PARENT_ONLY 改為 **INACTIVE**，exclusionReason 改為「人工決定刪除／停用，不建立預算輸入表、不顯示於可選部門、不建立BudgetVersion、不列入預算進度分母。」——原始 ERP 來源、`sourceSheets`／`sourceCells`／`evidence` 全數保留（未物理刪除該筆紀錄），供日後稽核；未來 Stage 2B-2 正式匯入時不得建立或啟用 `12501` Department，若資料庫未來已有 `12501` 只能設為停用，不得連帶刪除歷史 BudgetVersion／BudgetLine／AuditLog。BUDGET_OWNER 維持 45、PARENT_ONLY 由 17 降為 16、INACTIVE 由 5 增為 6、NEEDS_CONFIRMATION 維持 0 |

**本階段性質：唯讀盤點與設計報告。未修改 Prisma schema、未新增 migration、未寫入任何本機／Preview／Neon 資料庫、未呼叫 demo seed、未建立 BudgetVersion、未合併 PR。詳見 §10。**

分支：`claude/stage2a-eight-department-test`（基準 commit `6756169` 及其祖先，未從 `main`／`claude/demo-budget-seed` 另起）。

---

## 0　來源檔案與版本聲明

- 來源檔：`2025費用總表-第一版(20241122).xlsx`（使用者上傳，72 個工作表）。
- **來源年度／版本日期：本檔案內容為 2025 年度預算編列版本（工作表內多處標示「2025年目標計劃」「2025年預算(含新員+博計)」），部分明細頁「本年年度」欄位落在 2021～2024 之間（各部門最後一次更新的時間點不同，非全部同步於同一天）。本盤點的部門名冊、代碼、明細頁結構，僅代表 2025 年度編列當下的組織狀態，不宣稱等同於目前（2027 年度編製週期）最新組織架構——是否有 2026～2027 年間的部門新增、裁撤、改名，本檔案無法回答，需人工另行確認。**
- 本檔案未被提交進 git（原始檔為外部業務資料，且體積達 7MB）；比對用的資料萃取工具（`scripts/stage2b1/`）與盤點結果（`docs/data/stage2b1-department-manifest.{json,csv}`）已提交，供任何人重新執行同一份原始檔驗證。
- 所有引用的儲存格／公式，皆由 `scripts/stage2b1/dump-workbook.js` 對原始檔案做完整、逐儲存格（含公式字串與最後一次 Excel 計算快取值）之匯出後，再以 `scripts/stage2b1/crossref-departments.js` 交叉比對取得——非肉眼抽查，也非僅檢查前幾欄。

---

## 1　全部 ERP 部門逐筆盤點表

完整 68 筆機器可讀資料在 `docs/data/stage2b1-department-manifest.json`（含 CSV 版本），每筆包含 `departmentCode`／`workbookName`／`normalizedName`／`category`／`domesticOrOverseas`／`disposition`／`rollupParentCode`／`mergedIntoCode`／`sourceSheets`／`sourceCells`／`evidence`／`exclusionReason`／`hasDedicatedDetailSheet`／`appearsInSummarySheet`／`isStage2ATestDepartment`／`isExistingRealDepartment` 共 16 個欄位。以下為逐筆摘要（依 ERP部門 分頁原始列序，不省略任何一列）：

| # | 代碼 | 工作表名稱 | 大類 | 海外 | 處置 | 上層代碼 | 併入代碼 |
|---|---|---|---|---|---|---|---|
| 1 | 3001 | GWS(拋轉) | NEEDS_CONFIRMATION | — | INACTIVE | — | — |
| 2 | 10003 | 董事長室 | M | 否 | BUDGET_OWNER | 17003 | — |
| 3 | 10103 | 稽核室 | M | 否 | BUDGET_OWNER | 17003 | — |
| 4 | 10203 | 經營企劃室 | M | 否 | BUDGET_OWNER | 17003 | — |
| 5 | 10303 | 勞安室 | M | 否 | BUDGET_OWNER | 17003 | — |
| 6 | 11002 | 研發事業本部 | R | 否 | PARENT_ONLY | — | — |
| 7 | 11012 | 研發二部 | R | 否 | BUDGET_OWNER | 11002 | — |
| 8 | 11022 | 工設機構部 | R | 否 | BUDGET_OWNER | — | — |
| 9 | 11102 | 電源研發事業處 | R | 否 | PARENT_ONLY | 11002 | — |
| 10 | 11112 | 電源一部(2024/5停用) | R | 否 | MERGED | — | 11122 |
| 11 | 11122 | 電源研發部 | R | 否 | BUDGET_OWNER＊ | 11102 | — |
| 12 | 11132 | 電源軟體 | R | 否 | BUDGET_OWNER＊ | 11102 | — |
| 13 | 11202 | 量測研發事業處 | R | 否 | PARENT_ONLY | 11002 | — |
| 14 | 11212 | 量測研發部 | R | 否 | BUDGET_OWNER | 11202 | — |
| 15 | 11222 | 研發工程部 | R | 否 | BUDGET_OWNER | — | — |
| 16 | 11302 | 通用儀器研發事業處 | R | 否 | PARENT_ONLY | 11002 | — |
| 17 | 11322 | 研發一部 | R | 否 | BUDGET_OWNER（Stage2A） | 11302 | — |
| 18 | 11402 | 事業投資發展處 | R | 否 | BUDGET_OWNER | — | — |
| 19 | 12001 | 第一營業本部 | S | 否 | BUDGET_OWNER | — | — |
| 20 | 12011 | 系統整合部 | S | 否 | BUDGET_OWNER | — | — |
| 21 | 12101 | 台灣營業處 | S | 否 | PARENT_ONLY | — | — |
| 22 | 12111 | 台北 | S | 否 | BUDGET_OWNER（Stage2A） | 12101 | — |
| 23 | 12121 | 台中 | S | 否 | BUDGET_OWNER | 12101 | — |
| 24 | 12131 | 高雄 | S | 否 | BUDGET_OWNER | 12101 | — |
| 25 | 12141 | 儀器-SI特販部(無) | S | 否 | INACTIVE | — | — |
| 26 | 12201 | 行銷拓展處 | S | 否 | PARENT_ONLY | — | — |
| 27 | 12211 | 行銷技術 | S | 否 | BUDGET_OWNER | 12201 | — |
| 28 | 12221 | 行銷支援部 | S | 否 | BUDGET_OWNER | 12201 | — |
| 29 | 12231 | SI特販部(無) | S | 否 | INACTIVE | — | — |
| 30 | 12301 | 海外營業處 | S | 是 | PARENT_ONLY | — | — |
| 31 | 12311 | 營業一部 | S | 是 | BUDGET_OWNER＊ | 12301 | — |
| 32 | 12321 | 營業二部 | S | 是 | BUDGET_OWNER＊ | 12301 | — |
| 33 | 12331 | 海外行銷部(無) | S | 是 | INACTIVE（v1.2 人工裁決） | 12301 | — |
| 34 | 12401 | 營業企劃處 | S | 否 | PARENT_ONLY（v1.2 人工裁決） | — | — |
| 35 | 12411 | 成品企劃部 | S | 否 | BUDGET_OWNER | 12401 | — |
| 36 | 12421 | 客戶服務部 | S | 否 | BUDGET_OWNER | 12401 | — |
| 37 | 12501 | 教研營業處 | S | 否 | INACTIVE（v1.3 人工裁決，確定停用） | — | — |
| 38 | 13001 | 第二營業本部 | S | 否 | PARENT_ONLY（v1.1 人工裁決） | — | — |
| 39 | 13101 | 南亞暨ODM營業處 | S | 否 | PARENT_ONLY | 13001 | — |
| 40 | 13111 | ODM營業部 | S | 否 | BUDGET_OWNER | 13101 | — |
| 41 | 13201 | 安防事業處 | S | 否 | PARENT_ONLY | — | — |
| 42 | 13211 | 營業部（安防） | S | 否 | BUDGET_OWNER★雙類別 | 13201 | — |
| 43 | 13221 | 營業技術部（安防） | S | 否 | BUDGET_OWNER | 13201 | — |
| 44 | 13231 | 研發部（安防，研發） | R | 否 | BUDGET_OWNER | 13201 | — |
| 45 | 14001 | 第三營業本部 | S | 否 | PARENT_ONLY（v1.1 人工裁決） | — | — |
| 46 | 15001 | 台灣特販本部 | S | 否 | PARENT_ONLY | — | — |
| 47 | 15011 | 台灣特販部 | S | 否 | BUDGET_OWNER | 15001 | — |
| 48 | 16004 | 生產本部 | P | 否 | PARENT_ONLY | — | — |
| 49 | 16104 | 台灣廠 | P | 否 | PARENT_ONLY（v1.2 補註） | 16004 | — |
| 50 | 16114 | 生技部 | P | 否 | BUDGET_OWNER | 16104 | — |
| 51 | 16124 | 生產部 | P | 否 | BUDGET_OWNER（Stage2A）★雙類別 | 16104 | — |
| 52 | 16134 | 資材部 | P | 否 | BUDGET_OWNER | 16104 | — |
| 53 | 16144 | 採購部 | P | 否 | BUDGET_OWNER | 16104 | — |
| 54 | 16204 | 台灣廠品保處 | P | 否 | BUDGET_OWNER（Stage2A） | 16004 | — |
| 55 | 17003 | 管理本部 | M | 否 | PARENT_ONLY | — | — |
| 56 | 17103 | 資訊處 | M | 否 | BUDGET_OWNER（Stage2A） | 17003 | — |
| 57 | 17203 | 財務管理處 | M | 否 | BUDGET_OWNER（既有正式資料） | 17003 | — |
| 58 | 17303 | 行政管理處 | M | 否 | BUDGET_OWNER（Stage2A） | 17003 | — |
| 59 | 20001 | GWK | S | 是 | BUDGET_OWNER（Stage2A） | — | — |
| 60 | 30001 | GWSEA | S | 是 | BUDGET_OWNER | — | — |
| 61 | 40001 | 固緯上海(工作表標「GWH」) | S | 是 | BUDGET_OWNER | — | — |
| 62 | 50001 | GWU | S | 是 | BUDGET_OWNER | — | — |
| 63 | 60001 | GWE | S | 是 | BUDGET_OWNER | — | — |
| 64 | 70001 | GWI(工作表標「銷-南亞GWI」) | S | 是 | BUDGET_OWNER | — | — |
| 65 | 80001 | TEXIO(工作表標「銷-TTC」) | S | 是 | BUDGET_OWNER | — | — |
| 66 | 90001 | 大陸環測事業處(原GWA) | S | 是 | BUDGET_OWNER | — | — |
| 67 | A0004 | 蘇州廠 | S | 是 | BUDGET_OWNER | — | — |
| 68 | A1004 | 蘇州品保處(無) | S | 是 | INACTIVE | — | — |

＊：合併欄位案例，見 §4。★雙類別：同一代碼有兩張獨立明細頁分屬不同大類，見 §5 風險 1／2。

---

## 2　四大體系的 BUDGET_OWNER 候選清單與數量

依 `docs/data/stage2b1-department-manifest.json` 統計（disposition = BUDGET_OWNER，含標註★雙類別但主分類已定的部門；13231 依實證計入 R，非其代碼所在的 13xxx 區段）：

| 大類 | 候選數 | 名單 |
|---|---|---|
| R（研發） | 9 | 11012 研發二部、11022 工設機構部、11122 電源研發部＊、11132 電源軟體＊、11212 量測研發部、11222 研發工程部、11322 研發一部、11402 事業投資發展處、13231 研發部（安防） |
| M（管理） | 7 | 10003 董事長室、10103 稽核室、10203 經營企劃室、10303 勞安室、17103 資訊處、17203 財務管理處、17303 行政管理處 |
| S（營業） | 24 | 12001、12011、12111、12121、12131、12211、12221、12311＊、12321＊、12411、12421、13111、13211★、13221、15011、20001、30001、40001、50001、60001、70001、80001、90001、A0004 |
| P（生產） | 5 | 16114 生技部、16124 生產部★、16134 資材部、16144 採購部、16204 台灣廠品保處 |
| **合計** | **45** | （PARENT_ONLY 16、MERGED 1、INACTIVE 6、NEEDS_CONFIRMATION 0，共 68；v1.3 更新，見版本紀錄） |

---

## 3　PARENT_ONLY／INACTIVE／MERGED／NEEDS_CONFIRMATION 清單

### 3.1　PARENT_ONLY（16 筆，純上層彙總，不直接輸入）

前 12 筆（不含 16104）為 v1.0 原始盤點結果，`16104` 於 v1.2 補上 exclusionReason 註記（disposition 自 v1.0 起即為 PARENT_ONLY，未變更、不重複計數）；後 3 筆（標示「v1.2 人工裁決」）原為 §3.4 的 NEEDS_CONFIRMATION，經人工明確確認為上層彙總單位，於 v1.1／v1.2 改列於此——原始調查證據（出現位置、明細頁、公式）全數保留，未刪除任何部門紀錄。`12331` 已於 v1.2、`12501` 已於 v1.3 分別改列 §3.3 INACTIVE，不再列於本節（詳見各自條目）。

| 代碼 | 名稱 | 證據摘要 |
|---|---|---|
| 11002 | 研發事業本部 | ERP部門僅列名，全檔零出現 |
| 11102 | 電源研發事業處 | 全檔零出現，子代碼 11122/11132 才是實際列 |
| 11202 | 量測研發事業處 | 全檔零出現，子代碼 11212 才是實際列 |
| 11302 | 通用儀器研發事業處 | 2024組織圖有分組標籤、歷史帳有紀錄，但 2025 彙總表無專屬欄位 |
| 12101 | 台灣營業處 | B.營管生產與編制!row11 = SUM(台北+台中+高雄) |
| 12201 | 行銷拓展處 | B.營管生產與編制!row13 = 營業總計!L6+M6（行銷技術+行銷支援） |
| 12301 | 海外營業處 | B.營管生產與編制!row6 = SUM(row4:row5)（營一/二＋海外行銷企劃） |
| 13101 | 南亞暨ODM營業處 | 全檔零出現（含歷史帳），子代碼 13111 才是實際列 |
| 13201 | 安防事業處 | 歷史帳有 576 筆，但 2025 彙總表無專屬欄位；三個子代碼分屬 S／R 兩類 |
| 15001 | 台灣特販本部 | 全檔零出現，子代碼 15011 才是實際列 |
| 16004 | 生產本部 | 全檔零出現（含歷史帳），為生產大類最上層標籤 |
| 16104 | 台灣廠 | B.營管生產與編制!row64 = SUM(生產+生技+資材+採購)，不含品保。**v1.2 補註**：人工確認為上層彙總單位，補上 exclusionReason（disposition 自 v1.0 起即為 PARENT_ONLY，未變更） |
| 17003 | 管理本部 | 全檔零出現，行政總計／B表直接列出 7 個 M 部門，無中介欄 |
| 12401 | 營業企劃處 | **v1.2 人工裁決**（修正 v1.1 的通用理由）：確認為上層彙總單位，下屬 12411（成品企劃部）及 12421（客戶服務部）分別編製預算。原始證據（保留）：全檔零出現（含歷史帳），但子代碼 12411/12421 是活躍 BUDGET_OWNER；比照 12201/12301 的模式 |
| 13001 | 第二營業本部 | **v1.1 人工裁決**：確認為上層彙總單位。原始證據（保留）：全檔零出現（含歷史帳），是除 A1004 外唯一完全零蹤跡的代碼，但未被標「無」 |
| 14001 | 第三營業本部 | **v1.1 人工裁決**：確認為上層彙總單位。原始證據（保留）：無 2025 彙總或明細頁，歷史帳有 8 筆紀錄 |

### 3.2　MERGED（1 筆，已明確併入他碼）

| 代碼 | 名稱 | 併入 | 證據 |
|---|---|---|---|
| 11112 | 電源一部(2024/5停用) | 11122 | ERP部門備註「2024合併到11122」；其明細頁「研-電一(電研X)」仍存在但無任何 2025 公式引用；事業總計 2025 欄位只加總「研-電二(電研)」＋「研-電軟」 |

### 3.3　INACTIVE（6 筆，已停用或標示「無」）

前 4 筆為 v1.0 原始盤點結果；第 5 筆（`12331`，標示「v1.2 人工裁決」）原於 v1.1 誤列為 §3.1 PARENT_ONLY，人工於 v1.2 更正——原始名稱本身已標示「無」，正確分類是 INACTIVE 而非上層彙總單位；第 6 筆（`12501`，標示「v1.3 人工裁決」）原於 v1.1 列為 PARENT_ONLY，人工於 v1.3 追加裁決，確定從系統部門名冊停用，性質不同於「原始檔即標示無」，而是「人工決定刪除／停用」——正式匯入 Stage 2B-2 時不得建立或啟用 `12501` Department，若資料庫未來已有 `12501` 只能設為停用，不得連帶刪除歷史 BudgetVersion／BudgetLine／AuditLog。原始調查證據全數保留，未刪除任何部門紀錄。

| 代碼 | 名稱 | 證據 |
|---|---|---|
| 12141 | 儀器-SI特販部(無) | 有明細頁「銷-經營拓展SI特販(x)」但零公式引用；歷史帳 1,110 筆（過去曾存在） |
| 12231 | SI特販部(無) | 無明細頁、零公式引用；歷史帳 1,008 筆 |
| A1004 | 蘇州品保處(無) | 全檔零出現，含歷史帳，最乾淨的停用案例 |
| 3001 | GWS(拋轉) | 全檔零出現（含歷史帳，扣除數字巧合誤判後）；ERP部門備註「拋轉」暗示為舊轉入代碼 |
| 12331 | 海外行銷部(無) | **v1.2 人工裁決**（修正 v1.1 誤判）：原始名稱明確標示「無」，應為 INACTIVE。原始證據（保留）：ERP部門標「無」且明細頁名含「(x)」停用標記，但該頁仍被 2025 彙總公式實際加總（B表row5「海外行銷企劃」＝1,290,000）——與其他 INACTIVE 案例不同之處在於此頁仍被彙總公式引用，但人工確認正確分類仍是 INACTIVE（標「無」為決定性依據），非 PARENT_ONLY。彙總上層：12301（海外營業處） |
| 12501 | 教研營業處 | **v1.3 人工追加裁決**：確定從系統部門名冊停用（人工決定刪除／停用，非原始檔標示「無」）。原始證據（保留）：無 2025 彙總或明細頁，歷史帳有 3 筆紀錄。exclusionReason：「人工決定刪除／停用，不建立預算輸入表、不顯示於可選部門、不建立BudgetVersion、不列入預算進度分母。」Stage 2B-2 正式匯入時不得建立或啟用此 Department；若資料庫未來已有 12501，只能設為停用，不得連帶刪除歷史 BudgetVersion／BudgetLine／AuditLog |

### 3.4　NEEDS_CONFIRMATION（0 筆，v1.0 原有的 5 筆已於 v1.1 全數裁決）

v1.0 原列於此的 5 筆（`12331`／`12401`／`12501`／`13001`／`14001`）已由人工於 Stage 2B-1 裁決回覆中明確確認皆為上層彙總單位，全數改列 §3.1 PARENT_ONLY（保留原始調查證據，未刪除任何部門紀錄）。本節保留標題與筆數（0）供未來版本比對用，不再列出個別條目。

---

## 4　合併欄位（原始檔如何合併／兩種方案／影響）— 不代為決定

盤點過程中發現**兩組**結構相同的合併案例（使用者原始問題只點名 11122/11132，完整交叉核對後另發現 12311/12321 也是同一模式）：

### 4.1　案例一：11122（電源研發部）／11132（電源軟體）

**原始檔如何合併**：兩者各自擁有完整、獨立的明細頁（`研-電二(電研)`／`研-電軟`，各自的序3-67科目、薪資、獎金等逐項金額皆分開記錄），但在唯一的「2025 年度編制與預算」權威表 `A.事業費用與編制`（row7「電源事業處」，負責人：莊耀全）中，只有**一列**合併輸入——`事業總計` 支援表的公式也是 `'研-電二(電研)'!C8+'研-電軟'!C8` 直接相加，欄位標題本身就寫成合併字串 `"11122/11132"`。

**方案 A：維持合併（一個編製單位）**
- 做法：Stage 2B 建立單一 BudgetVersion／Department，對應「電源事業處」，內部科目金額為兩份明細的合計，負責人維持莊耀全一人。
- 影響：與原始 2025 工作表的實際編列方式（唯一一列 2025 目標）完全一致，彙總表與原始檔的「電源事業處」列可以逐欄核對；但無法個別追蹤 11122 與 11132 各自的用人費用是否超支，兩者責任歸屬混在一起。

**方案 B：拆成兩個編製單位**
- 做法：11122、11132 各自建立獨立 BudgetVersion，比照 Stage 2A 現行對 11122 的處理方式（Stage 2A 已把 11122 當作獨立測試部門）。
- 影響：與各自的明細頁（各有獨立序3-67科目資料）技術上可行，且與 Stage 2A 現有資料結構一致；但彙總後若要重現原始檔「電源事業處」單一列的呈現，系統需要另外做一次「顯示層合併」（如同 Stage 2A 現有的 `reportingAccountKey` 科目層級合併機制，但這次是「部門層級」合併，目前系統沒有這一層）；且拆開後兩個編製單位若都可獨立送出/核准，需要額外規則防止「電源事業處」被視為已完成，卻只有其中一個子單位真正送出。

### 4.2　案例二：12311（營業一部）／12321（營業二部）— 額外發現，結構相同

**原始檔如何合併**：與案例一結構完全相同。各自明細頁（`銷-海外營一`／`銷-海外營二`）獨立，但權威表 `B.營管生產與編制` row4「海外營業本部」（負責人：林佑城）同樣是唯一一列合併輸入，`營業總計` 欄位標題同樣寫成合併字串 `"12311/12321"`，公式同樣是兩個明細頁相加。

**方案 A／方案 B 與案例一完全對應**（維持合併 vs. 拆開兩個編製單位），影響分析相同，不重複列出。

**兩案例共通提醒**：無論選 A 或 B，兩案例應採**同一套規則**處理（不建議一組合併、一組拆開，除非有業務理由差異），因為兩者在原始檔中的結構、公式模式完全一致。此為需要人工決定的問題之一，見 §6。

---

## 5　可能重複計算或遺漏的風險

### 風險 1（高）：13211（安防事業處-營業部）在原始檔「全公司」總表中被算兩次

- **證據**：`13211` 有兩張各自獨立、各自以 `VLOOKUP(C3,ERP部門!A:B,2,FALSE)` 自證代碼的明細頁：`銷-安防營業`（餵入 S/營業 大類）與 `生-影安`（餵入 P/生產 大類的「影像安防」列，`B.營管生產與編制!row66`）。
- **原始檔本身的計算路徑**：`B.營管生產與編制!row71`「全公司(含影像)」＝ `row68`(生產費用合計，含影像＝row67+row66，其中 row66 直接來自 `'生-影安'!C8` = 13211單獨) ＋ `row32`(營業費用含影像＝row30+row31，其中 row30「影像安防」來自 `營業總計!T6`，該欄本身就是 `'銷-安防營業'!C8`(13211) + `'銷-安防營業技術'!C8`(13221) 相加)。
- **結論**：13211 的金額同時出現在 row66（單獨）與 row30 內含的 T 欄（與13221合計）兩處，兩者又分別被算進「全公司(含影像)」的生產與營業兩塊，**造成 13211 在原始 2025 工作表自己的「全公司」欄位裡就已經是重複計算**，非 Stage 2A/2B 引入的新問題。Stage 2B 若要以此欄位做為任何「公司總計」的基準，必須先決定 13211 只算一次（哪一類）或明確允許雙重列示但不加總。

### 風險 2（高）：16124（生產部）在原始檔中同樣橫跨 P 與 S 兩張明細頁

- **證據**：`生-生產`（P，`B.營管生產與編制!row60`）與 `銷-生產部`（S，`營業總計!C7`／`營業本部總表IS` 全公司營業加總公式內）皆各自以 VLOOKUP 自證代碼 16124。
- Stage 2A 現行測試資料只使用了「生-生產」對應的 P 類科目結構；「銷-生產部」這一塊完全未被 Stage 2A 觸及，過去六輪報告皆未提及此明細頁存在。
- **結論**：若 Stage 2B 之後要重現原始檔「全公司」層級的真實總額，需要決定 16124 的 Sales 分量是否也要建模，否則任何拿 2025 原始檔總額來做「回歸測試」基準的動作都會對不起來。

### 風險 3（中）：M／S 科目編號前綴的對應方向，文件與程式碼互相矛盾（非本階段引入，屬既有問題）

發現三方互不一致，皆有明確出處，恕不代為裁決：

1. 原始檔「科目清單」分頁自身的「單位別」欄位：`6110010 薪資支出` 標為「管理」（即 61xx＝M）。
2. `docs/budget-system-spec-v0.4.md` 版本紀錄 v0.3：「原依檔案『單位別』欄位標記為61xx管理、62xx營業，與你確認的實際慣例相反，此版以你的說法為準」，即文件目前**明文宣告** 61xx＝營業(S)、62xx＝管理(M)，與來源檔第1點相反。
3. 目前實際程式碼 `src/lib/reports/reportingAccountMap.ts`（`SGA_REPORTING_ACCOUNTS`）與 `src/lib/testdata/stage2aAccounts.ts`：科目對照表寫的是 `M: "6110010", S: "6210010"`，即**程式碼目前採用的是 61xx＝M、62xx＝S**——與第1點一致，但與第2點（文件明文決議）相反。

Stage 2A 測試資料因為是「自己造、自己用」（seed 出的 Account 本身就用程式碼裡的 M/S 對照表建立），數字本身內部自洽，不會在目前的畫面上顯示錯誤；但一旦未來要對真實部門的真實 2025/2026 科目資料做任何比對或匯入，必須先解決這三方矛盾中哪一個才是對的，否則會出現「同一個部門的薪資支出，被系統歸進錯誤大類彙總」的錯誤而不自知。

### 風險 4（中）：16104「台灣廠」父列刻意不含 16204「台灣廠品保處」

- `B.營管生產與編制!row64`（台灣廠小計）= SUM(生產+生技+資材+採購)，明確不含品保；品保是在 row67「生產費用合計」才與台灣廠並列相加。
- 若 Stage 2B 的 `rollupParentCode` 欄位機械式地把「16204 的上層是 16104」寫死（因為兩者名字都帶「台灣廠」），會與原始檔本身的加總邏輯不符（16204 在原始檔中其實是與 16104 同一層的手足，不是 16104 的子項）。本盤點manifest 已將 16204 的 `rollupParentCode` 正確標為 16004（生產本部），不是 16104。

### 風險 5（低）：命名混淆，容易在日後產生錯誤對照

- 40001 官方名稱「固緯上海」，工作表一律稱「GWH」。
- 70001「GWI」的工作表卻叫「銷-南亞GWI」（多了地區前綴）。
- 80001「TEXIO」的工作表卻叫「銷-TTC」（完全不同的字串）。
- A0004「蘇州廠」的工作表叫「銷-GWS」，與 3001「GWS(拋轉)」的非正式暱稱「GWS」**完全是兩個不同部門**，若日後有人用「GWS」這個字串做模糊比對去找部門，極可能誤配到錯誤的一個。

### 風險 6（低，已裁決）：12401「營業企劃處」完全查無蹤跡

- 與同構型的 12201／12301 都有一個明確的 SUM 彙總列不同，12401 連一個彙總列都沒有——本檔案本身無法重建其彙總公式。
- **v1.1 更新**：人工已明確確認 12401 為上層彙總單位（12411/12421 的彙總層級），已改列 §3.1 PARENT_ONLY，不再是開放風險項目；此處保留原始技術觀察供留存。

---

## 6　既有 Stage 2A 八部門與財務管理處之對照

Stage 2A 目前使用的 9 個部門（8 個測試部門＋1 個既有真實部門），在完整 68 筆名冊中的位置如下——**皆為既有部門，非新重複部門**：

| Stage 2A 代碼 | 名稱 | 在完整名冊中的位置 | disposition |
|---|---|---|---|
| 17103 | 資訊處 | M，直屬 17003（管理本部，PARENT_ONLY） | BUDGET_OWNER |
| 17303 | 行政管理處 | M，直屬 17003 | BUDGET_OWNER |
| 12111 | 台北 | S，直屬 12101（台灣營業處，PARENT_ONLY） | BUDGET_OWNER |
| 20001 | GWK | S，海外 | BUDGET_OWNER |
| 11122 | 電源研發部 | R，直屬 11102（電源研發事業處，PARENT_ONLY） | BUDGET_OWNER，⚠ 屬合併案例一（§4.1），與 11132 在原始檔中合報 |
| 11322 | 研發一部 | R，直屬 11302（通用儀器研發事業處，PARENT_ONLY） | BUDGET_OWNER |
| 16124 | 生產部 | P，直屬 16004（生產本部，PARENT_ONLY，非16104） | BUDGET_OWNER，⚠ 屬雙類別風險（§5風險2），另有「銷-生產部」明細頁未被使用 |
| 16204 | 台灣廠品保處 | P，直屬 16004（非16104，見§5風險4） | BUDGET_OWNER |
| 17203 | 財務管理處 | M，直屬 17003；**這是既有正式資料，非 Stage 2A 測試資料**（`isTestData=false`），已於本輪保護規則中確認絕不觸碰 | BUDGET_OWNER |

以上 9 碼在完整 68 筆名冊中皆已各自佔一列、非重複建立；本盤點的用途是把它們放回完整組織脈絡中，而非另外造出新的部門記錄。

---

## 7　預算編製進度總表：欄位與狀態定義（設計，不實作）

### 7.1　狀態機

| 狀態 | 定義 |
|---|---|
| NOT_STARTED | 該部門該年度尚未建立 BudgetVersion |
| IN_PROGRESS | 已有 BudgetVersion（狀態 DRAFT/RETURNED/ADJUSTMENT_PENDING），且至少一筆欄位已由使用者明確輸入或確認，但尚未達到「必填內容均已確認」 |
| READY_TO_SUBMIT | 必填內容均已確認（見7.2 定義），尚未按下送出 |
| SUBMITTED | 對應現有 `BudgetStatus.SUBMITTED` |
| UNDER_REVIEW | 對應現有 `BudgetStatus.UNDER_REVIEW` |
| RETURNED | 對應現有 `BudgetStatus.RETURNED`（退回後應重新落入 IN_PROGRESS／READY_TO_SUBMIT 其中之一，依欄位確認情形動態計算，不是固定字面值） |
| APPROVED | 對應現有 `BudgetStatus.APPROVED`（含 LOCKED／ADJUSTED，依既有狀態機延伸） |

NOT_STARTED／IN_PROGRESS／READY_TO_SUBMIT 三者是**衍生狀態**（由 BudgetVersion 是否存在＋其欄位確認情形計算得出，不是資料庫裡新增的列舉值），SUBMITTED 以後則直接對應既有 `BudgetStatus`——避免和現有狀態機重複維護兩套真相來源。

### 7.2　五種資料狀態必須可靠區分（現況問題與解法方向）

現況：`BudgetLine.nextYearTargetExcludingNew`／`nextYearNewHireBudget` 皆為非 nullable Decimal，預設值 0；唯一區分「尚未輸入」與「已輸入」的方法是 `createdAt === updatedAt`（`multiDepartmentSummary.ts#lineIsTouched`）。使用者已指出這在以下情境會失真：
- Stage 2A 的「修復既有環境」批次 SQL UPDATE（本輪之前的 bc95abc 等 commit）曾經全表批次改寫 `entryTypeSnapshot`／`isLocked`，若同一批次不慎連帶更新 `updatedAt`，會讓「seed 建立、使用者從未碰過」的列誤判為「已輸入」。
- 任何未來的資料修復、批次匯入、schema 遷移後的回填，都有同樣風險。

需要區分的五種狀態：

| 狀態 | 現況能否區分 | 說明 |
|---|---|---|
| 尚未填寫 | 部分可（createdAt===updatedAt），但不可靠 | 見上 |
| 使用者明確輸入／確認 0 元 | 否 | 系統無法區分「使用者刻意填 0」與「seed 建立的預設 0」——兩者在資料庫裡看起來完全一樣（值都是 0） |
| seed 建立的預設 0 | 否 | 同上 |
| 系統計算值（如 nextYearTotal、成長率） | 可（本來就是系統欄位，非人工輸入） | 不在本問題範圍，僅列出以求完整 |
| 人工已完成確認（不只是有填數字，而是使用者確認「這科目就是這樣，可以送出」） | 完全沒有 | 現行系統沒有任何「逐科目確認」的概念，只有「送出整個 BudgetVersion」這個粗粒度動作 |

### 7.3　三種方案比較

#### 方案 A：`BudgetLine` 新增 `inputConfirmedAt`／`inputConfirmedBy`

- **做法**：`BudgetLine` 增加兩個 nullable 欄位。使用者在畫面上對某一列做出「有意義的輸入動作」（例如 blur 且值有變化，或明確按下「確認此列」）時才寫入這兩個欄位；seed／批次修復程式**絕對不得**觸碰這兩欄。
- **migration 影響**：對 `BudgetLine` 加兩個 nullable 欄位，屬於非破壞性 additive migration，不需要資料轉型；但需要決定既有資料如何回填（見下）。
- **既有資料回填**：無法回溯判斷「過去到底是不是使用者自己填的」，只能保守地將現有 `updatedAt !== createdAt` 的列，回填 `inputConfirmedAt = updatedAt`（等於延用現行推斷邏輯做一次性快照），未來新資料則採用嚴謹規則寫入；回填後現況不會變壞，但過去因批次更新而誤判的列，仍會被誤標為「已確認」——此為技術上無法回溯彌補的資料缺口，需要人工知悉並接受。
- **回復方式**：直接 drop 兩個欄位即可完整復原，無資料遺失風險（因為這兩欄本來就是新增的、不影響既有欄位）。
- **優點**：改動最小、最貼近現有 `pendingSave` 前端機制（前端本來就知道「使用者剛剛按下的是哪一列」），可以直接在既有的 `updateDepartmentInputLine` service function 內順手補寫。
- **缺點**：語意上仍然是「附加在數字旁邊的一個時間戳」，容易被下一次不小心的批次 UPDATE 波及（除非額外寫防護測試，例如既有的 `tests/stage2aSeed.test.ts` 就曾經因為這類批次更新誤傷既有欄位而需要新增回歸測試——同樣的紀律需要延續到這兩個新欄位上）。

#### 方案 B：預算輸入欄位改為 nullable，另加部門完成確認時間

- **做法**：`nextYearTargetExcludingNew`／`nextYearNewHireBudget` 改為 nullable（`null` = 尚未輸入，`0` = 使用者明確輸入的 0），`nextYearTotal` 等系統計算欄位比照處理；另在 `BudgetVersion` 層級加一個 `preparationConfirmedAt`（部門主管確認「本部門所有科目都已填好」的時間點）。
- **migration 影響**：**破壞性/需轉型的 migration**——`nextYearTargetExcludingNew`／`nextYearNewHireBudget` 目前是 `@default(0)` 非 nullable，改 nullable 本身雖然是 relax constraint（技術上安全），但所有讀取這兩個欄位、假設它們一定是數字的既有程式碼（`buildDeptAgg`／`buildLineAgg`／`computeCategorySummary`／Excel／PDF 匯出等，粗估十餘處）都必須改寫成處理 `null`，等同於把現在已經用 `lineIsTouched`／`versionHasBudgetInput` 額外判斷「是否已輸入」的邏輯，直接內建進欄位本身的型別語意——概念上更乾淨，但改動面最大。
- **既有資料回填**：需要決定「現有資料庫裡所有 `updatedAt===createdAt` 的列，要不要把值從 0 改回 null」——這本身就是一次資料轉型（UPDATE 陳述式），且回填規則與方案A面臨一模一樣的「無法回溯確認過去到底有沒有被使用者碰過」的問題。
- **回復方式**：若要撤銷，需要先把所有 `null` 值轉回 `0`（否則既有程式碼會出現非預期的 null 處理錯誤），是有資料轉型成本的回復，不像方案A那樣單純 drop 欄位。
- **優點**：從根本解決「0 vs 未填」的歧義，未來任何新程式碼都不會再犯同樣的錯誤（因為型別本身就禁止歧義），最貼近使用者「不可再單獨用 createdAt===updatedAt 判斷」的期待。
- **缺點**：改動面最大、風險最高，需要仔細盤點並修改所有讀取這兩欄位的既有程式碼與測試（初估至少 `lineService.ts`／`multiDepartmentSummary.ts`／`categorySummary.ts`／Excel/PDF 匯出／`BudgetVersionClient.tsx` 等六個以上檔案），且無法在一次 migration 內做到「先加欄位、觀察、確認沒問題後才移除舊語意」的漸進式改法。

#### 方案 C：獨立 `BudgetPreparationProgress`／`BudgetLineConfirmation` 資料表

- **做法**：新增一張 `BudgetLineConfirmation`（`budgetLineId` 一對一或一對多、`confirmedAt`、`confirmedById`、`confirmedValueSnapshot`）記錄「這一列曾經被使用者明確確認過，確認當下的值是多少」；另一張 `BudgetPreparationProgress`（`budgetVersionId` 一對一，`status` 五態衍生狀態的**快取**、`lastComputedAt`）供彙總表快速查詢，不必每次都重新掃描全部 BudgetLine。
- **migration 影響**：全新增資料表，**對既有 `BudgetLine`／`BudgetVersion` 完全零改動**（不加欄位、不改型別），是三個方案中對既有 schema 侵入性最小的一個。
- **既有資料回填**：與方案 A 相同的限制（無法回溯確認歷史真偽），但因為是獨立表，回填只是「寫入幾筆新資料列」，完全不影響既有 `BudgetLine`／`BudgetVersion` 本身的任何欄位值，最安全。
- **回復方式**：直接 `DROP TABLE` 兩張新表即可完整復原，對既有系統零副作用，是三個方案中最容易安全撤回的。
- **優點**：與既有欄位完全解耦，不必修改任何現有的讀取邏輯（現有 `lineIsTouched` 等函式可以完全不變，新邏輯是額外查詢、不是取代）；未來若要擴充「確認理由」「確認時使用者看到的畫面版本」等稽核需求，都在這張獨立表上加欄位即可，不會牽動主表。
- **缺點**：多一次 JOIN／查詢成本（對於彙總表這種需要跨部門聚合的場景，效能影響需要實測，但可以用 `BudgetPreparationProgress` 這張快取表緩解）；且存在「兩份資料何時會不同步」的新風險（`BudgetLine` 的值被改了，但 `BudgetLineConfirmation` 沒有跟著失效），需要額外設計「值改變時自動清除確認標記」的規則（例如 `updateDepartmentInputLine` 每次真正改值時，順手刪除該列對應的 `BudgetLineConfirmation`）。

### 7.4　推薦方案

**推薦方案 A（`BudgetLine` 新增 `inputConfirmedAt`／`inputConfirmedBy`），理由**：
1. 三方案中，方案 A 與方案 C 的既有資料回填限制相同（都無法回溯過去的真偽），但方案 A 的改動範圍遠小於方案 C（不需要新增資料表、不需要設計「值改變時清除確認標記」的額外規則——因為時間戳與數值同欄同列，天然綁定，改值時只要求呼叫端一併清空 `inputConfirmedAt` 即可，是同一次 UPDATE 內的事，不必跨表協調）。
2. 方案 B 雖然最乾淨，但改動面最大、風險最高，且屬於「破壞性欄位語意變更」，與使用者本次「本階段不要實作」的唯讀盤點性質最不相容——若未來真的要往這個方向做，應該是一個獨立、審慎規劃的 Stage，而非附帶在進度總表設計裡順手做掉。
3. 方案 A 可以與既有 `pendingSave`／`updateDepartmentInputLine` 機制無縫銜接（使用者已經在本輪之前的 Stage 明確要求「已有pendingSave機制的預算頁應重用，不要建立第二套互相衝突的機制」——方案 A 精神上與此一致：不建第二套平行的確認機制，只是在既有的儲存路徑上多寫兩個時間戳）。

（本推薦僅供 Stage 2B-2 決策參考，本階段不建立對應 migration，見 §10。）

---

## 8　推薦資料模型與是否需要 migration

承 §7.4：推薦方案 A。**本階段（Stage 2B-1）不建立、不執行任何 migration**——本節僅說明「若進入 Stage 2B-2，該 migration 大致的形狀」，供人工審閱，非本輪交付物：

```prisma
// 示意，非本階段實際變更
model BudgetLine {
  // ...既有欄位不變...
  inputConfirmedAt DateTime?
  inputConfirmedBy String?
}
```

以及一張新的（本階段亦不建立）「部門代碼對照表」候選設計方向，用來承接本次盤點結果（是否採納、如何命名、放在哪個 model，留給 Stage 2B-2 決定，本階段只指出這個需求存在）：一個能表達 `departmentCode → category / disposition / rollupParentCode / mergedIntoCode` 的主檔，目前系統的 `Department.class` 欄位只能表達單一大類，無法表達 PARENT_ONLY／MERGED／NEEDS_CONFIRMATION 這些「這個代碼是否該有自己 BudgetVersion」的中繼狀態——這是本次盤點暴露出的一個既有資料模型缺口，而非本階段要解決的問題。

---

## 9　Stage 2B-2 的實作檔案範圍與測試計畫（草案，供人工核准後才開始）

**前提：§3.4 的 5 筆 NEEDS_CONFIRMATION 已於 v1.1 由人工裁決完成（見版本紀錄），尚待人工確認的剩餘事項為：§4 的 2 組合併案例決定方案、§5 風險 1/2 的雙類別代碼處理方式、§5 風險 3 的 M/S 前綴方向決定——全數完成後才可開始 Stage 2B-2，本階段不自行進入。**

若獲核准，預估涉及的檔案範圍（僅供規劃，本階段未實作）：

- `prisma/schema.prisma`：§8 所述的 `BudgetLine.inputConfirmedAt`／`inputConfirmedBy`（若採方案A）。
- `src/lib/budget/lineService.ts`：`updateDepartmentInputLine` 於真正寫入新值時一併寫入/清除確認時間戳。
- `src/lib/reports/multiDepartmentSummary.ts`：新增或取代 `lineIsTouched`，改用確認時間戳而非 `createdAt===updatedAt`。
- `src/lib/testdata/stage2aSeed.ts`：若要把新確認的部門（依 §3.4 決議後成為 BUDGET_OWNER 的部門）納入測試資料，需要擴充 `STAGE2A_ACCOUNTS`／部門清單，並比照既有 `isLineEditable` 規則驗證。
- `src/app/dashboard/reports/budget-summary-preview/`：若擴大 `KNOWN_DEPARTMENT_CODES` 範圍，需要重新檢視 `UNIT_BLOCKS` 是否要新增本次盤點確認的其他部門（如海外的 GWU/GWE/GWI 等目前不在 `budgetSummaryPreviewData.ts` 清單中的代碼）。
- `docs/budget-system-spec-v0.4.md`：§1.2 部門清單需要以本次盤點結果整批取代（目前是前綴猜測版本），並在版本紀錄新增 v0.5。

測試計畫方向（草案）：
1. 針對 §7.4 推薦方案，補齊「值改變時確認時間戳必須被清除」的單元測試（比照 §7.4 提到的既有回歸測試紀律）。
2. 針對 §4 的合併案例，無論最終選方案A或B，都需要新增「部門加總＝科目加總」的雙向一致性測試（延伸既有 `docs/budget-system-spec-v0.4.md §5.1` 的檢核規則）。
3. 針對 §5 風險1/2 的雙類別代碼，若決定要建模，需要新增「同一 ERP 代碼、兩個 BudgetVersion（分屬不同 category）」情境下，彙總表不會誤判為重複部門的測試。
4. 針對 §3.4 NEEDS_CONFIRMATION 清單，每一筆一旦被人工裁決，都應該有一則對應的 reconciliation manifest 更新 + 至少一則說明其歸類理由的測試/文件，避免下次改版時又要重新調查一次——v1.0 的 5 筆已依此模式於 v1.1 完成（見版本紀錄），未來若再有新的 NEEDS_CONFIRMATION 項目應延續同一流程。

---

## 10　本階段無資料庫寫入、無 schema/migration 變更之證明

- `git status --short`（本輪工作結束時）：僅包含新增的 `docs/stage2b1-department-reconciliation.md`、`docs/data/stage2b1-department-manifest.{json,csv}`、`scripts/stage2b1/*.js` 四類純文件/唯讀工具檔案，**不含** `prisma/schema.prisma`、`prisma/migrations/`、任何 `src/` 下的業務邏輯檔案。
- `git diff --stat -- prisma/`：空（無任何變更）。
- 本階段全程未啟動本機 `next dev`、未呼叫 `/api/demo/*`、未執行 `npx prisma migrate`、未執行 `runStage2ATestSeed`／`seedDemoMasterData`，只對外部上傳的 `.xlsx` 檔案做唯讀解析（`ExcelJS.Workbook#xlsx.readFile`，從未呼叫任何寫入 API）。
- 原始 `.xlsx` 來源檔本身未被提交進 git（僅其解析結果與解析工具程式碼提交），避免把 7MB 業務資料檔案帶進版本庫。
- PR #3 維持 draft，本階段未呼叫任何合併相關操作。

**v1.1 更新同樣適用**：本輪僅修改 `docs/stage2b1-department-reconciliation.md`、`docs/data/stage2b1-department-manifest.{json,csv}` 三個文件檔案（`git diff --stat -- src/ prisma/` 為空），未執行 migration、未 reseed、未建立任何 BudgetVersion、未寫入任何資料庫；修改前後皆以自動化檢查驗證（68 個代碼不遺漏不重複、五種 disposition 合計＝68、五筆裁決部門不出現在 BUDGET_OWNER、不列入進度分母），詳見 commit message。

**v1.2 更新同樣適用**：本輪修正 v1.1 對 `12331`／`12401` 的誤判，並補上 `16104` 的 exclusionReason 註記，另經人工再次確認 `A0004` 維持 BUDGET_OWNER 不變（本輪未觸碰）；同樣僅修改上述三個文件檔案（`git diff --stat -- src/ prisma/` 為空），未執行 migration、未 reseed、未建立任何 BudgetVersion、未寫入任何資料庫；修改前後皆以自動化檢查驗證（68 個代碼不遺漏不重複、五種 disposition 合計＝68、A0004 維持 BUDGET_OWNER、所有非 BUDGET_OWNER 部門不列入進度分母），詳見 commit message。

**v1.3 更新同樣適用**：本輪追加裁決 `12501` 確定停用（PARENT_ONLY → INACTIVE），未物理刪除該筆紀錄、原始 ERP 來源與 `sourceSheets`／`sourceCells`／`evidence` 全數保留供日後稽核；同樣僅修改上述三個文件檔案（`git diff --stat -- src/ prisma/` 為空），未執行 migration、未 reseed、未建立任何 BudgetVersion、未寫入任何資料庫、未執行 seed；修改前後皆以自動化檢查驗證（68 個代碼不遺漏不重複、五種 disposition 合計＝68、A0004 維持 BUDGET_OWNER、12501 未被物理刪除、所有非 BUDGET_OWNER 部門不列入進度分母），詳見 commit message。Stage 2B-2 正式匯入時不得建立或啟用 `12501` Department；若資料庫未來已有 `12501`，只能設為停用，不得連帶刪除歷史 BudgetVersion／BudgetLine／AuditLog。
