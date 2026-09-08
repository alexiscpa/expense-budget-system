import { WQY_ZENHEI_SUBSET_BASE64 } from "./fonts/wqyZenheiSubsetBase64";

let cached: Buffer | null = null;

/** The embedded Traditional-Chinese-capable font used by every PDF export (see fonts/README.md). */
export function getCjkFontBuffer(): Buffer {
  if (!cached) cached = Buffer.from(WQY_ZENHEI_SUBSET_BASE64, "base64");
  return cached;
}
