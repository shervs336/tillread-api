import type { DecimalSeparator } from "./types.js";
/**
 * Reads one amount into integer minor units (cents by default), without floating-point error.
 *
 * Understands `-12.50`, `12.50-`, `(12.50)`, `+12.50`, `12.50 CR`, `12.50 DR`, `$1,234.56`,
 * `1.234,56 €`, `1 234,56`, `1'234.50` and `−12.50` (Unicode minus). Returns `null` for
 * anything else, including empty cells and a lone `-`.
 */
export declare function parseAmount(raw: string | undefined, decimal?: DecimalSeparator, minorUnits?: number): number | null;
/**
 * Guesses the decimal separator from a sample of amounts. `1.234,56` and `-12,50` vote for a
 * comma; `1,234.56` and `-12.50` vote for a dot; `1,234` on its own doesn't vote.
 */
export declare function detectDecimal(values: readonly string[]): {
    decimal: DecimalSeparator;
    votes: number;
};
/** Formats minor units back into a plain decimal string: `-123456` → `"-1234.56"`. */
export declare function formatMinor(amount: number, minorUnits?: number): string;
