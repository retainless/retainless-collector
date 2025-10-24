import {CommandOptions} from "commander";

export interface CLIOptions extends CommandOptions {
    start: string;
    end: string;
}
