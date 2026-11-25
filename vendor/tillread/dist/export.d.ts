import type { Transaction } from "./types.js";
export interface ToCsvOptions {
    /** Digits after the decimal point. Default 2. */
    minorUnits?: number;
    delimiter?: string;
}
/**
 * Writes transactions as a clean CSV: `Date,Description,Amount,…`.
 *
 * Text cells starting with `=`, `+`, `-`, `@`, tab or carriage return get a leading apostrophe,
 * so a merchant name like `=HYPERLINK(…)` can't run as a formula when the file is opened in a
 * spreadsheet (CSV injection).
 */
export declare function toCSV(transactions: readonly Transaction[], options?: ToCsvOptions): string;
