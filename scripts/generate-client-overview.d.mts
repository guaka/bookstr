#!/usr/bin/env node
export interface ClientInventory {
    version: number;
    clients: Array<Record<string, string>>;
}
type InventoryIO = {
    readFile(path: string, encoding: 'utf8'): Promise<string>;
    writeFile(path: string, value: string): Promise<unknown>;
};
type InventoryServices = {
    run?: (args: string[]) => Promise<string>;
    writeError?: (message: string) => unknown;
    fail?: () => void;
};
export declare function validateInventory(raw: unknown): ClientInventory;
export declare function renderOverview(inventory: ClientInventory): string;
export declare function parseArgs(args: string[]): {
    check: boolean;
    input: string;
    output: string;
};
export declare function run(args: string[], io?: InventoryIO, cwd?: string): Promise<"checked" | "generated">;
export declare function cli(args: string[], services?: InventoryServices): Promise<string>;
export declare function invokeIfMain(moduleUrl: string, argv: string[], action?: typeof cli): Promise<string>;
export {};
