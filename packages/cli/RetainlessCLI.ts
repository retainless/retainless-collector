#!/usr/bin/env node
import {Command} from "commander";
import {DateTime} from "luxon";
import {DailyChurnRateCLI} from "./commands/DailyChurnRate.js";
import {DailyRetentionCLI} from "./commands/DailyRetention.js";
import {WeeklyRetentionCLI} from "./commands/WeeklyRetention.js";

export const RetainlessCLI = new Command("retainless");
RetainlessCLI.showHelpAfterError();

RetainlessCLI.option('-s --start <string>', "Earliest period", DateTime.now().startOf('month').toISODate());
RetainlessCLI.option('-e --end <string>', "Latest period", DateTime.now().endOf('month').toISODate());

RetainlessCLI.addCommand(DailyChurnRateCLI);
DailyChurnRateCLI.copyInheritedSettings(RetainlessCLI);

RetainlessCLI.addCommand(DailyRetentionCLI);
DailyRetentionCLI.copyInheritedSettings(RetainlessCLI);

RetainlessCLI.addCommand(WeeklyRetentionCLI);
WeeklyRetentionCLI.copyInheritedSettings(RetainlessCLI);

if (import.meta.url.endsWith(process.argv[1]!)) {
    await RetainlessCLI.parseAsync(process.argv);
}
