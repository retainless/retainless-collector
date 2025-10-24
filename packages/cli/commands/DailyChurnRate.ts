import {DateTime} from "luxon";
import {loadUsers} from "../shared/LoadUsers.js";
import {Command} from "commander";
import {CLIOptions} from "../shared/CLIOptions.js";


import '../LuxonConfigure.js';

export async function dailyChurnRate(_: unknown, command: Command) {
    const options = command.optsWithGlobals<CLIOptions>();
    const users = await loadUsers(options);
    const visitorsByCohort = new Map<string, number[]>();

    for (const user of users) {
        const periodEnd = DateTime.fromISO(user.periodEnd.S);
        const visitsPrior = user.visitsPrior?.L.map((visit) => DateTime.fromISO(visit.M.periodEnd.S)) ?? [];
        const firstVisit = DateTime.min(...visitsPrior, periodEnd);

        const cohort = firstVisit.startOf('day');
        const cohortId = cohort.toISODate();
        const visitors = visitorsByCohort.get(cohortId) ?? [];

        let counts = [];

        if (visitsPrior.length > 0) {
            // we already counted their prior sessions, so skip double-counting
            const latestPriorVisit = DateTime.max(...visitsPrior)!;
            const priorOffset = Math.floor(latestPriorVisit.diff(cohort, 'days').days);
            for (let i = 0; i <= priorOffset; i++) {
                counts[i] = 0;
            }
        }

        const daysOffset = Math.floor(periodEnd.diff(cohort, 'days').days)
        if (counts[daysOffset] === undefined) {
            counts[daysOffset] = 1;
        }

        for (let i = 0; i < counts.length; i++) {
            visitors[i] = (visitors[i] ?? 0) + (counts[i] ?? 1);
        }
        visitorsByCohort.set(cohortId, visitors);
    }

    const sortedVisitorsByCohort = [...visitorsByCohort.entries()]
        .sort(([a], [b]) => a.localeCompare(b));
    console.log('CohortDay,DayOffset,UsersSurviving,PoolSize,CohortSize');
    for (const [cohortDay, usersReturnedByOffset] of sortedVisitorsByCohort) {
        for (let i = 0; i < usersReturnedByOffset.length; i++) {
            console.log(`${cohortDay},${i},${usersReturnedByOffset[i]},${usersReturnedByOffset[Math.max(0, i-1)]},${usersReturnedByOffset[0]}`);
        }
    }
}

export const DailyChurnRateCLI = new Command('daily-churn-rate');
DailyChurnRateCLI.summary("survival rate of users based on their first visit");

// language=markdown
DailyChurnRateCLI.description(`
Survival rate (or fall-off rate) is the number of users who still find your site
useful after a specified number of days, as measured by the duration between
their first visit and their last visit.

Example output:

CohortDay,DayOffset,UsersSurviving,PoolSize,CohortSize
2025-10-08,0,100,100,100
2025-10-08,1,25,100,100
2025-10-08,2,22,25,100
2025-10-08,3,20,22,100
2025-10-08,4,18,20,100
2025-10-09,0,100,100,100
2025-10-09,1,25,100,100
2025-10-09,2,20,25,100
2025-10-09,3,16,20,100
`.trim());

DailyChurnRateCLI.action(dailyChurnRate);
