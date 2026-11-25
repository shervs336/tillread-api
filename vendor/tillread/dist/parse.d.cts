import type { Input, ParseOptions, ParseResult } from "./types.cjs";
/**
 * Reads a bank CSV export into transactions.
 *
 * ```ts
 * import { parse } from "tillread";
 * const { transactions, skipped, detection } = parse(await file.text());
 * ```
 *
 * Amounts are integers in minor units (cents), negative for money out. Rows that look like data
 * but can't be read (totals, pending rows, typos) are returned in `skipped` with a reason, never
 * silently dropped.
 */
export declare function parse(input: Input, options?: ParseOptions): ParseResult;
