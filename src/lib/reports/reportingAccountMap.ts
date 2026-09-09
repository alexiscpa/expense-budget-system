import type { AccountCommonCategory } from "@prisma/client";

/**
 * Explicit, auditable Account.code -> 報表科目 (reporting account) mapping
 * for the two multi-department summary tables (管銷研科目彙總 /
 * 生產科目彙總). Every row here traces back one-to-one to
 * `stage2aAccounts.ts`'s own STAGE2A_ACCOUNTS list, which is itself
 * "Auto-extracted from 2025費用總表-第一版(20241122).xlsx sheet '科目清單'
 * cross-referenced with 2025預算編列說明.xlsx" (see that file's header) -
 * this module does not invent any new source-of-truth, it only re-groups
 * that already-audited list by reporting line instead of by department.
 *
 * WHY a static table instead of computing this at runtime: 管理(M)/營業(S)/
 * 研發(R) each use their own Account.code for the "same" reporting line
 * (e.g. 薪資支出 is 6110010 for M, 6210010 for S, 6310010 for R - the
 * pattern is "61"/"62"/"63" + an identical suffix, verified to hold for
 * all 62 STAGE2A_ACCOUNTS M/S/R rows with zero mismatches or gaps - see
 * scripts/tmp-analyze-accounts.ts, not committed). Grouping by
 * `Account.code` alone would produce 3 separate rows per reporting line;
 * grouping by `Account.name` alone (a plain GROUP BY at query time) would
 * risk silently merging two accounts that happen to share a name but are
 * NOT the same reporting line (the very failure mode this table exists to
 * prevent - see 財務管理處's own manually-created test account further
 * down, which is deliberately NOT wired into this table even though its
 * name is also "薪資支出"). Naming this account code explicitly, once,
 * here, is the only way to merge M/S/R's three codes into one reporting
 * row without ever risking a same-name-different-account collision.
 *
 * Production (P) accounts use entirely separate codes (53xxxx/54xxxx) with
 * no M/S/R counterpart at all, so PRODUCTION_REPORTING_ACCOUNTS is a
 * disjoint, independently-numbered system (`PROD-<code>` keys) - it must
 * never be merged with SGA_REPORTING_ACCOUNTS, and no code below appears in
 * both lists.
 *
 * A real Account.code that appears in neither list (e.g. 財務管理處's own
 * manually-created demo account, code "3") is NOT silently dropped or
 * name-matched into a row here - callers must bucket it into a separate
 * "待確認科目" list (see findReportingAccount below returning undefined)
 * rather than guessing which reporting line it belongs to.
 */

export type ReportingAccountScope = "SGA" | "PRODUCTION";

export interface ReportingAccountMapping {
  reportingAccountKey: string;
  reportingAccountName: string;
  scope: ReportingAccountScope;
  commonCategory: AccountCommonCategory;
  /** 1-based display order within its scope, matching STAGE2A_ACCOUNTS' own row order (which mirrors the source Excel row order - see that file's header). */
  order: number;
  /** The specific Account.code(s) this reporting line is built from, one per department class it applies to. SGA rows carry M/S/R; PRODUCTION rows carry only P. */
  sourceCodes: { M?: string; S?: string; R?: string; P?: string };
}

export const SGA_REPORTING_ACCOUNTS: ReportingAccountMapping[] = [
  { reportingAccountKey: "SGA-10010", reportingAccountName: "薪資支出", scope: "SGA", commonCategory: "PERSONNEL", order: 1, sourceCodes: { M: "6110010", S: "6210010", R: "6310010" } },
  { reportingAccountKey: "SGA-10020", reportingAccountName: "業績獎金", scope: "SGA", commonCategory: "PERSONNEL", order: 2, sourceCodes: { M: "6110020", S: "6210020", R: "6310020" } },
  { reportingAccountKey: "SGA-10030", reportingAccountName: "端午獎金", scope: "SGA", commonCategory: "PERSONNEL", order: 3, sourceCodes: { M: "6110030", S: "6210030", R: "6310030" } },
  { reportingAccountKey: "SGA-10040", reportingAccountName: "中秋獎金", scope: "SGA", commonCategory: "PERSONNEL", order: 4, sourceCodes: { M: "6110040", S: "6210040", R: "6310040" } },
  { reportingAccountKey: "SGA-10050", reportingAccountName: "年終獎金", scope: "SGA", commonCategory: "PERSONNEL", order: 5, sourceCodes: { M: "6110050", S: "6210050", R: "6310050" } },
  { reportingAccountKey: "SGA-10060", reportingAccountName: "職工退休金", scope: "SGA", commonCategory: "PERSONNEL", order: 6, sourceCodes: { M: "6110060", S: "6210060", R: "6310060" } },
  { reportingAccountKey: "SGA-10061", reportingAccountName: "職工退休金(新制)", scope: "SGA", commonCategory: "PERSONNEL", order: 7, sourceCodes: { M: "6110061", S: "6210061", R: "6310061" } },
  { reportingAccountKey: "SGA-10070", reportingAccountName: "交通津貼", scope: "SGA", commonCategory: "PERSONNEL", order: 8, sourceCodes: { M: "6110070", S: "6210070", R: "6310070" } },
  { reportingAccountKey: "SGA-10080", reportingAccountName: "績效獎金", scope: "SGA", commonCategory: "PERSONNEL", order: 9, sourceCodes: { M: "6110080", S: "6210080", R: "6310080" } },
  { reportingAccountKey: "SGA-10090", reportingAccountName: "研究發明獎金", scope: "SGA", commonCategory: "PERSONNEL", order: 10, sourceCodes: { M: "6110090", S: "6210090", R: "6310090" } },
  { reportingAccountKey: "SGA-10091", reportingAccountName: "競賽獎金", scope: "SGA", commonCategory: "PERSONNEL", order: 11, sourceCodes: { M: "6110091", S: "6210091", R: "6310091" } },
  { reportingAccountKey: "SGA-17020", reportingAccountName: "人事廣告費", scope: "SGA", commonCategory: "PERSONNEL", order: 12, sourceCodes: { M: "6117020", S: "6217020", R: "6317020" } },
  { reportingAccountKey: "SGA-19010", reportingAccountName: "員工保險", scope: "SGA", commonCategory: "PERSONNEL", order: 13, sourceCodes: { M: "6119010", S: "6219010", R: "6319010" } },
  { reportingAccountKey: "SGA-27", reportingAccountName: "伙食費", scope: "SGA", commonCategory: "PERSONNEL", order: 14, sourceCodes: { M: "6127", S: "6227", R: "6327" } },
  { reportingAccountKey: "SGA-28", reportingAccountName: "職工福利", scope: "SGA", commonCategory: "PERSONNEL", order: 15, sourceCodes: { M: "6128", S: "6228", R: "6328" } },
  { reportingAccountKey: "SGA-31", reportingAccountName: "訓練費", scope: "SGA", commonCategory: "PERSONNEL", order: 16, sourceCodes: { M: "6131", S: "6231", R: "6331" } },
  { reportingAccountKey: "SGA-33", reportingAccountName: "加班費", scope: "SGA", commonCategory: "PERSONNEL", order: 17, sourceCodes: { M: "6133", S: "6233", R: "6333" } },
  { reportingAccountKey: "SGA-34", reportingAccountName: "交通費", scope: "SGA", commonCategory: "SG_AND_A", order: 18, sourceCodes: { M: "6134", S: "6234", R: "6334" } },
  { reportingAccountKey: "SGA-14", reportingAccountName: "運費", scope: "SGA", commonCategory: "SG_AND_A", order: 19, sourceCodes: { M: "6114", S: "6214", R: "6314" } },
  { reportingAccountKey: "SGA-20", reportingAccountName: "交際費", scope: "SGA", commonCategory: "SG_AND_A", order: 20, sourceCodes: { M: "6120", S: "6220", R: "6320" } },
  { reportingAccountKey: "SGA-30", reportingAccountName: "佣金支出", scope: "SGA", commonCategory: "SG_AND_A", order: 21, sourceCodes: { M: "6130", S: "6230", R: "6330" } },
  { reportingAccountKey: "SGA-37", reportingAccountName: "樣品費", scope: "SGA", commonCategory: "SG_AND_A", order: 22, sourceCodes: { M: "6137", S: "6237", R: "6337" } },
  { reportingAccountKey: "SGA-38", reportingAccountName: "專案費用", scope: "SGA", commonCategory: "SG_AND_A", order: 23, sourceCodes: { M: "6138", S: "6238", R: "6338" } },
  { reportingAccountKey: "SGA-40", reportingAccountName: "包裝費", scope: "SGA", commonCategory: "SG_AND_A", order: 24, sourceCodes: { M: "6140", S: "6240", R: "6340" } },
  { reportingAccountKey: "SGA-41", reportingAccountName: "工具", scope: "SGA", commonCategory: "SG_AND_A", order: 25, sourceCodes: { M: "6141", S: "6241", R: "6341" } },
  { reportingAccountKey: "SGA-13010", reportingAccountName: "國內旅費", scope: "SGA", commonCategory: "SG_AND_A", order: 26, sourceCodes: { M: "6113010", S: "6213010", R: "6313010" } },
  { reportingAccountKey: "SGA-13020", reportingAccountName: "國外旅費", scope: "SGA", commonCategory: "SG_AND_A", order: 27, sourceCodes: { M: "6113020", S: "6213020", R: "6313020" } },
  { reportingAccountKey: "SGA-13030", reportingAccountName: "國外旅費-大陸", scope: "SGA", commonCategory: "SG_AND_A", order: 28, sourceCodes: { M: "6113030", S: "6213030", R: "6313030" } },
  { reportingAccountKey: "SGA-17010", reportingAccountName: "廣告費-其他", scope: "SGA", commonCategory: "SG_AND_A", order: 29, sourceCodes: { M: "6117010", S: "6217010", R: "6317010" } },
  { reportingAccountKey: "SGA-32010", reportingAccountName: "出口費用-押匯費", scope: "SGA", commonCategory: "SG_AND_A", order: 30, sourceCodes: { M: "6132010", S: "6232010", R: "6332010" } },
  { reportingAccountKey: "SGA-32020", reportingAccountName: "出口費用-港工捐", scope: "SGA", commonCategory: "SG_AND_A", order: 31, sourceCodes: { M: "6132020", S: "6232020", R: "6332020" } },
  { reportingAccountKey: "SGA-32030", reportingAccountName: "出口費用-報關費", scope: "SGA", commonCategory: "SG_AND_A", order: 32, sourceCodes: { M: "6132030", S: "6232030", R: "6332030" } },
  { reportingAccountKey: "SGA-11", reportingAccountName: "租金支出", scope: "SGA", commonCategory: "OFFICE", order: 33, sourceCodes: { M: "6111", S: "6211", R: "6311" } },
  { reportingAccountKey: "SGA-12", reportingAccountName: "文具用品", scope: "SGA", commonCategory: "OFFICE", order: 34, sourceCodes: { M: "6112", S: "6212", R: "6312" } },
  { reportingAccountKey: "SGA-15", reportingAccountName: "郵電費", scope: "SGA", commonCategory: "OFFICE", order: 35, sourceCodes: { M: "6115", S: "6215", R: "6315" } },
  { reportingAccountKey: "SGA-16", reportingAccountName: "修繕費", scope: "SGA", commonCategory: "OFFICE", order: 36, sourceCodes: { M: "6116", S: "6216", R: "6316" } },
  { reportingAccountKey: "SGA-18", reportingAccountName: "水電瓦斯費用", scope: "SGA", commonCategory: "OFFICE", order: 37, sourceCodes: { M: "6118", S: "6218", R: "6318" } },
  { reportingAccountKey: "SGA-21", reportingAccountName: "捐贈", scope: "SGA", commonCategory: "OFFICE", order: 38, sourceCodes: { M: "6121", S: "6221", R: "6321" } },
  { reportingAccountKey: "SGA-22", reportingAccountName: "稅捐", scope: "SGA", commonCategory: "OFFICE", order: 39, sourceCodes: { M: "6122", S: "6222", R: "6322" } },
  { reportingAccountKey: "SGA-35", reportingAccountName: "勞務費", scope: "SGA", commonCategory: "OFFICE", order: 40, sourceCodes: { M: "6135", S: "6235", R: "6335" } },
  { reportingAccountKey: "SGA-36", reportingAccountName: "雜項購置", scope: "SGA", commonCategory: "OFFICE", order: 41, sourceCodes: { M: "6136", S: "6236", R: "6336" } },
  { reportingAccountKey: "SGA-39", reportingAccountName: "權利金", scope: "SGA", commonCategory: "OFFICE", order: 42, sourceCodes: { M: "6139", S: "6239", R: "6339" } },
  { reportingAccountKey: "SGA-43", reportingAccountName: "雜支", scope: "SGA", commonCategory: "OFFICE", order: 43, sourceCodes: { M: "6143", S: "6243", R: "6343" } },
  { reportingAccountKey: "SGA-19020", reportingAccountName: "保險費-其他", scope: "SGA", commonCategory: "OFFICE", order: 44, sourceCodes: { M: "6119020", S: "6219020", R: "6319020" } },
  { reportingAccountKey: "SGA-42010", reportingAccountName: "工程費", scope: "SGA", commonCategory: "OFFICE", order: 45, sourceCodes: { M: "6142010", S: "6242010", R: "6342010" } },
  { reportingAccountKey: "SGA-42020", reportingAccountName: "ICT工程費", scope: "SGA", commonCategory: "OFFICE", order: 46, sourceCodes: { M: "6142020", S: "6242020", R: "6342020" } },
  { reportingAccountKey: "SGA-23", reportingAccountName: "呆帳", scope: "SGA", commonCategory: "OTHER", order: 47, sourceCodes: { M: "6123", S: "6223", R: "6323" } },
  { reportingAccountKey: "SGA-24", reportingAccountName: "折舊", scope: "SGA", commonCategory: "OTHER", order: 48, sourceCodes: { M: "6124", S: "6224", R: "6324" } },
  { reportingAccountKey: "SGA-25", reportingAccountName: "各項攤提", scope: "SGA", commonCategory: "OTHER", order: 49, sourceCodes: { M: "6125", S: "6225", R: "6325" } },
  { reportingAccountKey: "SGA-44", reportingAccountName: "報廢費用", scope: "SGA", commonCategory: "OTHER", order: 50, sourceCodes: { M: "6144", S: "6244", R: "6344" } },
  { reportingAccountKey: "SGA-89", reportingAccountName: "分攤費用-薪資", scope: "SGA", commonCategory: "OTHER", order: 51, sourceCodes: { M: "6189", S: "6289", R: "6389" } },
  { reportingAccountKey: "SGA-45", reportingAccountName: "攤銷費用", scope: "SGA", commonCategory: "OTHER", order: 52, sourceCodes: { M: "6145", S: "6245", R: "6345" } },
  { reportingAccountKey: "SGA-87", reportingAccountName: "在建工程-薪資", scope: "SGA", commonCategory: "OTHER", order: 53, sourceCodes: { M: "6187", S: "6287", R: "6387" } },
  { reportingAccountKey: "SGA-88010", reportingAccountName: "其他費用-顧問費", scope: "SGA", commonCategory: "OTHER", order: 54, sourceCodes: { M: "6188010", S: "6288010", R: "6388010" } },
  { reportingAccountKey: "SGA-88020", reportingAccountName: "其他費用-技術移轉費", scope: "SGA", commonCategory: "OTHER", order: 55, sourceCodes: { M: "6188020", S: "6288020", R: "6388020" } },
  { reportingAccountKey: "SGA-88030", reportingAccountName: "其他費用-資料費", scope: "SGA", commonCategory: "OTHER", order: 56, sourceCodes: { M: "6188030", S: "6288030", R: "6388030" } },
  { reportingAccountKey: "SGA-88040", reportingAccountName: "其他費用-其他業務費", scope: "SGA", commonCategory: "OTHER", order: 57, sourceCodes: { M: "6188040", S: "6288040", R: "6388040" } },
  { reportingAccountKey: "SGA-88050", reportingAccountName: "其他費用-短程車資", scope: "SGA", commonCategory: "OTHER", order: 58, sourceCodes: { M: "6188050", S: "6288050", R: "6388050" } },
  { reportingAccountKey: "SGA-88060", reportingAccountName: "工業局補助款", scope: "SGA", commonCategory: "OTHER", order: 59, sourceCodes: { M: "6188060", S: "6288060", R: "6388060" } },
  { reportingAccountKey: "SGA-88061", reportingAccountName: "其他費用-保固維修", scope: "SGA", commonCategory: "OTHER", order: 60, sourceCodes: { M: "6188061", S: "6288061", R: "6388061" } },
  { reportingAccountKey: "SGA-88070", reportingAccountName: "其他費用-保固維修費用(內部移轉)", scope: "SGA", commonCategory: "OTHER", order: 61, sourceCodes: { M: "6188070", S: "6288070", R: "6388070" } },
  { reportingAccountKey: "SGA-88080", reportingAccountName: "其他費用-其他", scope: "SGA", commonCategory: "OTHER", order: 62, sourceCodes: { M: "6188080", S: "6288080", R: "6388080" } },
];

export const PRODUCTION_REPORTING_ACCOUNTS: ReportingAccountMapping[] = [
  { reportingAccountKey: "PROD-5310010", reportingAccountName: "直接人工-薪資", scope: "PRODUCTION", commonCategory: "PERSONNEL", order: 1, sourceCodes: { P: "5310010" } },
  { reportingAccountKey: "PROD-5310020", reportingAccountName: "直接人工-加班費", scope: "PRODUCTION", commonCategory: "PERSONNEL", order: 2, sourceCodes: { P: "5310020" } },
  { reportingAccountKey: "PROD-5310030", reportingAccountName: "直接人工-中秋獎金", scope: "PRODUCTION", commonCategory: "PERSONNEL", order: 3, sourceCodes: { P: "5310030" } },
  { reportingAccountKey: "PROD-5310040", reportingAccountName: "直接人工-端午獎金", scope: "PRODUCTION", commonCategory: "PERSONNEL", order: 4, sourceCodes: { P: "5310040" } },
  { reportingAccountKey: "PROD-5310050", reportingAccountName: "直接人工-年終獎金", scope: "PRODUCTION", commonCategory: "PERSONNEL", order: 5, sourceCodes: { P: "5310050" } },
  { reportingAccountKey: "PROD-5310060", reportingAccountName: "直接人工-職工退休金", scope: "PRODUCTION", commonCategory: "PERSONNEL", order: 6, sourceCodes: { P: "5310060" } },
  { reportingAccountKey: "PROD-5310061", reportingAccountName: "直接人工-職工退休金(新制)", scope: "PRODUCTION", commonCategory: "PERSONNEL", order: 7, sourceCodes: { P: "5310061" } },
  { reportingAccountKey: "PROD-5310070", reportingAccountName: "直接人工-績效獎金", scope: "PRODUCTION", commonCategory: "PERSONNEL", order: 8, sourceCodes: { P: "5310070" } },
  { reportingAccountKey: "PROD-5310091", reportingAccountName: "直接人工-競賽獎金", scope: "PRODUCTION", commonCategory: "PERSONNEL", order: 9, sourceCodes: { P: "5310091" } },
  { reportingAccountKey: "PROD-5410010", reportingAccountName: "間接人工-薪資", scope: "PRODUCTION", commonCategory: "PERSONNEL", order: 10, sourceCodes: { P: "5410010" } },
  { reportingAccountKey: "PROD-5410020", reportingAccountName: "間接人工-加班費", scope: "PRODUCTION", commonCategory: "PERSONNEL", order: 11, sourceCodes: { P: "5410020" } },
  { reportingAccountKey: "PROD-5410030", reportingAccountName: "間接人工-中秋獎金", scope: "PRODUCTION", commonCategory: "PERSONNEL", order: 12, sourceCodes: { P: "5410030" } },
  { reportingAccountKey: "PROD-5410040", reportingAccountName: "間接人工-端午獎金", scope: "PRODUCTION", commonCategory: "PERSONNEL", order: 13, sourceCodes: { P: "5410040" } },
  { reportingAccountKey: "PROD-5410050", reportingAccountName: "間接人工-年終獎金", scope: "PRODUCTION", commonCategory: "PERSONNEL", order: 14, sourceCodes: { P: "5410050" } },
  { reportingAccountKey: "PROD-5410060", reportingAccountName: "間接人工-職工退休金", scope: "PRODUCTION", commonCategory: "PERSONNEL", order: 15, sourceCodes: { P: "5410060" } },
  { reportingAccountKey: "PROD-5410061", reportingAccountName: "間接人工-職工退休金(新制)", scope: "PRODUCTION", commonCategory: "PERSONNEL", order: 16, sourceCodes: { P: "5410061" } },
  { reportingAccountKey: "PROD-5410070", reportingAccountName: "間接人工-交通津貼", scope: "PRODUCTION", commonCategory: "PERSONNEL", order: 17, sourceCodes: { P: "5410070" } },
  { reportingAccountKey: "PROD-5410080", reportingAccountName: "間接人工-績效獎金", scope: "PRODUCTION", commonCategory: "PERSONNEL", order: 18, sourceCodes: { P: "5410080" } },
  { reportingAccountKey: "PROD-5410091", reportingAccountName: "間接人工-競賽獎金", scope: "PRODUCTION", commonCategory: "PERSONNEL", order: 19, sourceCodes: { P: "5410091" } },
  { reportingAccountKey: "PROD-5417020", reportingAccountName: "人事廣告費", scope: "PRODUCTION", commonCategory: "PERSONNEL", order: 20, sourceCodes: { P: "5417020" } },
  { reportingAccountKey: "PROD-5419010", reportingAccountName: "員工保險", scope: "PRODUCTION", commonCategory: "PERSONNEL", order: 21, sourceCodes: { P: "5419010" } },
  { reportingAccountKey: "PROD-5427", reportingAccountName: "伙食費", scope: "PRODUCTION", commonCategory: "PERSONNEL", order: 22, sourceCodes: { P: "5427" } },
  { reportingAccountKey: "PROD-5428", reportingAccountName: "職工福利", scope: "PRODUCTION", commonCategory: "PERSONNEL", order: 23, sourceCodes: { P: "5428" } },
  { reportingAccountKey: "PROD-5431", reportingAccountName: "訓練費", scope: "PRODUCTION", commonCategory: "PERSONNEL", order: 24, sourceCodes: { P: "5431" } },
  { reportingAccountKey: "PROD-5413010", reportingAccountName: "交通費", scope: "PRODUCTION", commonCategory: "SG_AND_A", order: 25, sourceCodes: { P: "5413010" } },
  { reportingAccountKey: "PROD-5414", reportingAccountName: "運費", scope: "PRODUCTION", commonCategory: "SG_AND_A", order: 26, sourceCodes: { P: "5414" } },
  { reportingAccountKey: "PROD-5420", reportingAccountName: "交際費", scope: "PRODUCTION", commonCategory: "SG_AND_A", order: 27, sourceCodes: { P: "5420" } },
  { reportingAccountKey: "PROD-5433", reportingAccountName: "包裝費", scope: "PRODUCTION", commonCategory: "SG_AND_A", order: 28, sourceCodes: { P: "5433" } },
  { reportingAccountKey: "PROD-5437", reportingAccountName: "樣品費", scope: "PRODUCTION", commonCategory: "SG_AND_A", order: 29, sourceCodes: { P: "5437" } },
  { reportingAccountKey: "PROD-5413020", reportingAccountName: "國內旅費", scope: "PRODUCTION", commonCategory: "SG_AND_A", order: 30, sourceCodes: { P: "5413020" } },
  { reportingAccountKey: "PROD-5413030", reportingAccountName: "國外旅費", scope: "PRODUCTION", commonCategory: "SG_AND_A", order: 31, sourceCodes: { P: "5413030" } },
  { reportingAccountKey: "PROD-5413040", reportingAccountName: "國外旅費-大陸", scope: "PRODUCTION", commonCategory: "SG_AND_A", order: 32, sourceCodes: { P: "5413040" } },
  { reportingAccountKey: "PROD-5417010", reportingAccountName: "廣告費-其他", scope: "PRODUCTION", commonCategory: "SG_AND_A", order: 33, sourceCodes: { P: "5417010" } },
  { reportingAccountKey: "PROD-5488010", reportingAccountName: "工具", scope: "PRODUCTION", commonCategory: "SG_AND_A", order: 34, sourceCodes: { P: "5488010" } },
  { reportingAccountKey: "PROD-5488030", reportingAccountName: "雜支", scope: "PRODUCTION", commonCategory: "SG_AND_A", order: 35, sourceCodes: { P: "5488030" } },
  { reportingAccountKey: "PROD-5488040", reportingAccountName: "出口費用", scope: "PRODUCTION", commonCategory: "SG_AND_A", order: 36, sourceCodes: { P: "5488040" } },
  { reportingAccountKey: "PROD-5488070", reportingAccountName: "專案費用", scope: "PRODUCTION", commonCategory: "SG_AND_A", order: 37, sourceCodes: { P: "5488070" } },
  { reportingAccountKey: "PROD-5411", reportingAccountName: "租金支出", scope: "PRODUCTION", commonCategory: "OFFICE", order: 38, sourceCodes: { P: "5411" } },
  { reportingAccountKey: "PROD-5412", reportingAccountName: "文具用品", scope: "PRODUCTION", commonCategory: "OFFICE", order: 39, sourceCodes: { P: "5412" } },
  { reportingAccountKey: "PROD-5415", reportingAccountName: "郵電費", scope: "PRODUCTION", commonCategory: "OFFICE", order: 40, sourceCodes: { P: "5415" } },
  { reportingAccountKey: "PROD-5416", reportingAccountName: "修繕費", scope: "PRODUCTION", commonCategory: "OFFICE", order: 41, sourceCodes: { P: "5416" } },
  { reportingAccountKey: "PROD-5418", reportingAccountName: "水電瓦斯費用", scope: "PRODUCTION", commonCategory: "OFFICE", order: 42, sourceCodes: { P: "5418" } },
  { reportingAccountKey: "PROD-5421", reportingAccountName: "稅捐", scope: "PRODUCTION", commonCategory: "OFFICE", order: 43, sourceCodes: { P: "5421" } },
  { reportingAccountKey: "PROD-5436", reportingAccountName: "雜項購置", scope: "PRODUCTION", commonCategory: "OFFICE", order: 44, sourceCodes: { P: "5436" } },
  { reportingAccountKey: "PROD-5419020", reportingAccountName: "保險費-其他", scope: "PRODUCTION", commonCategory: "OFFICE", order: 45, sourceCodes: { P: "5419020" } },
  { reportingAccountKey: "PROD-5488020", reportingAccountName: "工程費", scope: "PRODUCTION", commonCategory: "OFFICE", order: 46, sourceCodes: { P: "5488020" } },
  { reportingAccountKey: "PROD-5424", reportingAccountName: "折舊", scope: "PRODUCTION", commonCategory: "OTHER", order: 47, sourceCodes: { P: "5424" } },
  { reportingAccountKey: "PROD-5425010", reportingAccountName: "各項攤提", scope: "PRODUCTION", commonCategory: "OTHER", order: 48, sourceCodes: { P: "5425010" } },
  { reportingAccountKey: "PROD-5425020", reportingAccountName: "各項攤提-管理分攤", scope: "PRODUCTION", commonCategory: "OTHER", order: 49, sourceCodes: { P: "5425020" } },
  { reportingAccountKey: "PROD-5488050", reportingAccountName: "損耗報廢費用", scope: "PRODUCTION", commonCategory: "OTHER", order: 50, sourceCodes: { P: "5488050" } },
  { reportingAccountKey: "PROD-5488060", reportingAccountName: "其他費用-其他", scope: "PRODUCTION", commonCategory: "OTHER", order: 51, sourceCodes: { P: "5488060" } },
  { reportingAccountKey: "PROD-5489", reportingAccountName: "分攤費用-薪資", scope: "PRODUCTION", commonCategory: "OTHER", order: 52, sourceCodes: { P: "5489" } },
];

/** All Account.code values wired into either table - used to detect "待確認科目" (an account code appearing on a real BudgetLine but absent from both lists above). */
const ALL_MAPPED_CODES: ReadonlySet<string> = new Set(
  [...SGA_REPORTING_ACCOUNTS, ...PRODUCTION_REPORTING_ACCOUNTS].flatMap((m) => Object.values(m.sourceCodes))
);

export function isMappedAccountCode(accountCode: string): boolean {
  return ALL_MAPPED_CODES.has(accountCode);
}

/**
 * Finds the reporting-account mapping row (if any) whose sourceCodes
 * includes this exact Account.code, within the given scope's table only -
 * never falls back to a name comparison. Returns undefined for a code that
 * has no explicit mapping (the "待確認科目" case) - callers must not guess.
 */
export function findReportingAccount(accountCode: string, scope: ReportingAccountScope): ReportingAccountMapping | undefined {
  const table = scope === "SGA" ? SGA_REPORTING_ACCOUNTS : PRODUCTION_REPORTING_ACCOUNTS;
  return table.find((m) => Object.values(m.sourceCodes).includes(accountCode));
}
