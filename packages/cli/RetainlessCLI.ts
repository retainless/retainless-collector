#!/usr/bin/env node
import {Command} from "commander";
import {DateTime} from "luxon";
import {DailyChurnCLI} from "./commands/DailyChurn.js";
import {DailyRetentionCLI} from "./commands/DailyRetention.js";
import {WeeklyRetentionCLI} from "./commands/WeeklyRetention.js";

export const RetainlessCLI = new Command("retainless");
RetainlessCLI.showHelpAfterError();

RetainlessCLI.option('-s --start <string>', "Earliest period", DateTime.now().startOf('month').toISODate());
RetainlessCLI.option('-e --end <string>', "Latest period", DateTime.now().endOf('month').toISODate());

RetainlessCLI.addCommand(DailyChurnCLI);
DailyChurnCLI.copyInheritedSettings(RetainlessCLI);

RetainlessCLI.addCommand(DailyRetentionCLI);
DailyRetentionCLI.copyInheritedSettings(RetainlessCLI);

RetainlessCLI.addCommand(WeeklyRetentionCLI);
WeeklyRetentionCLI.copyInheritedSettings(RetainlessCLI);

if (import.meta.url.endsWith(process.argv[1]!) || process.argv[1]!.endsWith('/retainless')) {
    await RetainlessCLI.parseAsync(process.argv);
}
