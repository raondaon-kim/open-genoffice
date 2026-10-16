/** the DLL names (lowercase) a PE image imports */
export function peImports(buf: Buffer): string[]
/** every program file in `dir` that `start` needs through files in `dir` (lowercase, `start` included) */
export function importClosure(dir: string, start: string): Set<string>
