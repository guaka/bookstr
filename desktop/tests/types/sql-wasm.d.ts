declare module '*web/vendor/sql-wasm.js' {
  interface SqlDatabase {
    run(sql: string): void;
    export(): Uint8Array;
    close(): void;
  }
  export default function initSqlJs(options: { locateFile(file: string): string }): Promise<{
    Database: new () => SqlDatabase;
  }>;
}
