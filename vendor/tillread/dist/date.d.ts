import type { DateFormat } from "./types.js";
/** Which kind of date a cell holds, without deciding day-month order. */
export declare function dateShape(raw: string): "ymd" | "numeric" | "named" | null;
/**
 * Reads one date into `YYYY-MM-DD`. `format` only matters for numeric dates like `03/04/2026`;
 * `2026-04-03`, `20260403`, `3 Apr 2026`, `Apr 3, 2026` and `03-Apr-26` are read the same way
 * whatever it is. A trailing time is ignored. Returns `null` for anything that isn't a real date.
 */
export declare function parseDate(raw: string | undefined, format?: DateFormat): string | null;
export interface DateFormatGuess {
    format: DateFormat;
    /** How it was decided. */
    basis: "unambiguous" | "votes" | "order" | "span" | "hint";
    /** 0–1 */
    certainty: number;
}
/**
 * Decides day-first or month-first once per file, so one row can't flip the rest.
 * 1. A first number above 12 votes day-first; a second number above 12 votes month-first.
 * 2. If nothing votes (every day is 12 or under), pick the reading that keeps the rows in date
 *    order, since statements are sorted.
 * 3. Then the reading that covers the shorter period.
 * 4. Otherwise fall back to `hint` (callers pass DMY for decimal-comma files).
 */
export declare function detectDateFormat(values: readonly string[], hint?: DateFormat): DateFormatGuess;
