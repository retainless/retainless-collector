#!/usr/bin/env node
import {Command} from "commander";
import {DailyChurnRateCLI} from "./commands/DailyChurnRate.js";
import {DailyRetentionCLI} from "./commands/DailyRetention.js";
import {WeeklyRetentionCLI} from "./commands/WeeklyRetention.js";

export const RetainlessCLI = new Command("retainless");
RetainlessCLI.showHelpAfterError();

RetainlessCLI.addCommand(DailyChurnRateCLI);
RetainlessCLI.addCommand(DailyRetentionCLI);
RetainlessCLI.addCommand(WeeklyRetentionCLI);

if (import.meta.url.endsWith(process.argv[1]!)) {
    await RetainlessCLI.parseAsync(process.argv);
}
