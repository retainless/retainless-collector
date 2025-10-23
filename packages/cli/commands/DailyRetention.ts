import {DateTime} from "luxon";
import {loadUsers} from "../shared/LoadUsers.js";
import {Command} from "commander";

import '../LuxonConfigure.js';

export async function dailyRetention() {
    const users = await loadUsers('tbd');
    const visitorsByCohort = new Map<string, number[]>();

    for (const user of users) {
        const periodEnd = DateTime.fromISO(user.periodEnd.S);
        const visitsPrior = user.visitsPrior?.L.map((visit) => DateTime.fromISO(visit.M.periodEnd.S)) ?? [];
        const firstVisit = DateTime.min(...visitsPrior, periodEnd);

        const cohort = firstVisit.startOf('day');
        const cohortId = cohort.toISODate();
        const visitors = visitorsByCohort.get(cohortId) ?? [];

        let counts = <number[]>[];
        const daysOffset = Math.floor(periodEnd.diff(cohort, 'days').days)
        counts[daysOffset] = (counts[daysOffset] ?? 0) + 1;

        for (let i = 0; i < counts.length; i++) {
            visitors[i] = (visitors[i] ?? 0) + (counts[i] ?? 0);
        }
        visitorsByCohort.set(cohortId, visitors);
    }

    const sortedVisitorsByCohort = [...visitorsByCohort.entries()]
        .sort(([a], [b]) => a.localeCompare(b));
    console.log('CohortDay,DayOffset,UsersActive,CohortSize');
    for (const [cohortDay, usersReturnedByOffset] of sortedVisitorsByCohort) {
        for (let i = 0; i < usersReturnedByOffset.length; i++) {
            console.log(`${cohortDay},${i},${usersReturnedByOffset[i]},${usersReturnedByOffset[0]}`);
        }
    }
}

export const DailyRetentionCLI = new Command('daily-retention');
DailyRetentionCLI.summary("daily retention rate of users");

// language=markdown
DailyRetentionCLI.description(`
Daily retention rate is the number of users who are using your site on a
specific day after their first visit. Compared to survival rate, this
metric can show you how certain weekdays affect user return.

Example output:

CohortDay,DayOffset,UsersActive,CohortSize
2025-10-08,0,100,100
2025-10-08,1,10,100
2025-10-08,2,4,100
2025-10-08,3,6,100
2025-10-08,4,5,100
2025-10-09,0,100,100
2025-10-09,1,2,100
2025-10-09,2,1,100
2025-10-09,3,8,100
`.trim());


DailyRetentionCLI.action(dailyRetention);

if (import.meta.url.endsWith(process.argv[1]!)) {
    await DailyRetentionCLI.parseAsync(process.argv);
}
