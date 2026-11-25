import type { Input } from "./types.cjs";
/**
 * Turns file bytes into text. Handles the encodings banks actually use:
 * UTF-8 (with or without a BOM), UTF-16 from Excel's "Unicode text" export, and Windows-1252
 * from older systems (so "Café" doesn't turn into "Caf�").
 */
export declare function decode(input: Input): string;
