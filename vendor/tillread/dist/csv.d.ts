/** A non-empty row and the 1-based line it starts on. */
export interface Row {
    cells: string[];
    line: number;
}
/**
 * RFC 4180 tokenizer (one pass, slices instead of per-character string building): quoted fields, doubled quotes, delimiters and line breaks inside quotes,
 * CRLF / LF / CR line endings. Unquoted cells are trimmed; empty rows are dropped.
 */
export declare function tokenize(text: string, delimiter?: string): Row[];
/**
 * Picks the delimiter that splits the start of the file into the most rows of the same width.
 * A decimal comma (`-12,50`) can't fool it: splitting on it gives ragged rows.
 */
export declare function detectDelimiter(text: string): string;
/** Writes rows as CSV, quoting only cells that need it. */
export declare function stringify(rows: readonly (readonly string[])[], delimiter?: string): string;
