import { runPlatformBaselineRoutingCli } from "./platform-baseline-routing.mjs";
process.stdout.write(`${runPlatformBaselineRoutingCli(process.argv.slice(2))}\n`);
