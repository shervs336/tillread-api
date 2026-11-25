/** How day, month and year are ordered in numeric dates such as `03/04/2026`. */
export type DateFormat = "YMD" | "DMY" | "MDY";
/** The decimal separator used in amounts: `1,234.56` uses ".", `1.234,56` uses ",". */
export type DecimalSeparator = "." | ",";
/**
 * How the file says which way money moved.
 * - `signed`: one amount column, money out is negative.
 * - `inverted`: one amount column, money out is positive (common on card statements).
 * - `split`: separate debit and credit columns.
 * - `direction`: one amount column plus a column such as `DR`/`CR` or `Af`/`Bij`.
 */
export type SignConvention = "signed" | "inverted" | "split" | "direction";
/** Zero-based column indexes for each field. Only `date` and `description` are always present. */
export interface ColumnMap {
    date: number;
    description: number;
    memo?: number;
    amount?: number;
    debit?: number;
    credit?: number;
    direction?: number;
    balance?: number;
    currency?: number;
    category?: number;
    reference?: number;
}
/** What tillread worked out about a file. Every field can be overridden through {@link ParseOptions}. */
export interface Detection {
    /** The field delimiter: `,`, `;`, tab or `|`. */
    delimiter: string;
    /** Index (among non-empty rows) of the header row, or `null` when the file has no header. */
    headerRow: number | null;
    /** Header names, or `Column 1`, `Column 2`… for files without a header. */
    headers: string[];
    columns: ColumnMap;
    dateFormat: DateFormat;
    decimal: DecimalSeparator;
    sign: SignConvention;
    /** Row order by date, when it can be told. */
    order: "ascending" | "descending" | "unknown";
    /** 0–1. Below about 0.7, show the detection to the user before importing. */
    confidence: number;
    /** How each decision was made, in plain words. Useful to show next to a preview. */
    notes: string[];
    /** Things that may be wrong, such as ambiguous dates. */
    warnings: string[];
}
export interface Transaction {
    /** ISO date, `YYYY-MM-DD`. */
    date: string;
    /** Integer in minor units (cents by default). Negative is money out. */
    amount: number;
    description: string;
    memo?: string;
    /** Running balance after this transaction, in minor units, when the file has one. */
    balance?: number;
    /** ISO 4217 code, when the file has a currency column. */
    currency?: string;
    category?: string;
    reference?: string;
    /** 1-based line in the original file, for pointing users at a row. */
    line: number;
    /** The row's original cells. */
    raw: string[];
}
export interface SkippedRow {
    line: number;
    reason: "date" | "amount" | "zero";
    message: string;
    raw: string[];
}
export interface ParseResult {
    transactions: Transaction[];
    /** Rows that looked like data but couldn't be read: totals, pending rows, typos. */
    skipped: SkippedRow[];
    detection: Detection;
}
export interface ParseOptions {
    delimiter?: string;
    /** Index of the header row among non-empty rows, or `null` for a file with no header. */
    headerRow?: number | null;
    /** Override some or all column choices. */
    columns?: Partial<ColumnMap>;
    dateFormat?: DateFormat;
    decimal?: DecimalSeparator;
    sign?: SignConvention;
    /** Digits after the decimal point for the currency. Default 2 (use 0 for JPY, 3 for KWD). */
    minorUnits?: number;
    /** Stop after this many data rows. Default 100,000. */
    maxRows?: number;
}
/** Anything {@link parse} accepts: text, or the raw bytes of a file in any common encoding. */
export type Input = string | ArrayBuffer | ArrayBufferView;
