import {Command, CommandOptions} from "commander";
import {DateTime} from "luxon";

export interface CLIOptions extends CommandOptions {
    start: DateTime;
    end: DateTime;
}

export function parseCommandOptions(command: Command): CLIOptions {
    const opts = command.optsWithGlobals();

    return {
        start: DateTime.fromISO(opts.start),
        /** End date is inclusive of a `periodEnd` immediately following this date */
        end: DateTime.fromISO(opts.end).plus({days: 1}).startOf('day'),
    }
}
