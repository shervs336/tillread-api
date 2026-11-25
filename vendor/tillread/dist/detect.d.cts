import { type Row } from "./csv.cjs";
import type { Detection, Input, ParseOptions } from "./types.cjs";
declare const directionOf: (v: string) => boolean | undefined;
/** Inspects a bank CSV and works out its layout. {@link parse} calls this for you. */
export declare function detect(input: Input, options?: ParseOptions): Detection;
/** @internal Detection plus the rows it was based on, so parse doesn't tokenize twice. */
export declare function analyze(text: string, options?: ParseOptions): {
    detection: Detection;
    rows: Row[];
    dataStart: number;
};
export { directionOf };
