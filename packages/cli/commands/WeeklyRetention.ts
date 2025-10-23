import {DateTime, Settings} from "luxon";
import {loadUsers} from "../shared/LoadUsers.js";
import {Command} from "commander";

import '../LuxonConfigure.js';

export async function weeklyRetention() {
    const users = await loadUsers('tbd');

    const visitorsByCohort = new Map<string, number[]>();

    for (const user of users) {
        const periodEnd = DateTime.fromISO(user.periodEnd.S);
        const visitsPrior = user.visitsPrior?.L.map((visit) => DateTime.fromISO(visit.M.periodEnd.S)) ?? [];
        const firstVisit = DateTime.min(...visitsPrior, periodEnd);

        const cohort = firstVisit.startOf('week');
        const cohortId = cohort.toISODate();
        const visitors = visitorsByCohort.get(cohortId) ?? [];

        let counts = <number[]>[];
        for (const visitDate of visitsPrior) {
            // mark any prior sessions as already-counted (under a separate userId)
            const weekOffset = Math.floor(visitDate.diff(cohort, 'weeks').weeks)
            counts[weekOffset] = 0;
        }

        const weekOffset = Math.floor(periodEnd.diff(cohort, 'weeks').weeks)
        if (counts[weekOffset] === undefined) {
            // only count the new visit if no prior session was already counted
            counts[weekOffset] = 1;
        }

        for (let i = 0; i < counts.length; i++) {
            visitors[i] = (visitors[i] ?? 0) + (counts[i] ?? 0);
        }
        visitorsByCohort.set(cohortId, visitors);
    }

    const sortedVisitorsByCohort = [...visitorsByCohort.entries()]
        .sort(([a], [b]) => a.localeCompare(b));
    console.log('CohortWeek,WeekOffset,UsersReturned,CohortSize');
    for (const [cohortWeek, usersReturnedByOffset] of sortedVisitorsByCohort) {
        for (let i = 0; i < usersReturnedByOffset.length; i++) {
            console.log(`${cohortWeek},${i},${usersReturnedByOffset[i]},${usersReturnedByOffset[0]}`);
        }
    }
}

export const WeeklyRetentionCLI = new Command('weekly-retention');
WeeklyRetentionCLI.summary("weekly retention rate of users");

// language=markdown
WeeklyRetentionCLI.description(`
Weekly retention rate is the number of users who are using your site on a
specific week after their first visit.

Example output:

CohortWeek,WeekOffset,UsersReturned,CohortSize
2025-10-06,0,100,100
2025-10-06,1,30,100
2025-10-13,0,100,100
`.trim());

WeeklyRetentionCLI.action(weeklyRetention);

if (import.meta.url.endsWith(process.argv[1]!)) {
    await WeeklyRetentionCLI.parseAsync(process.argv);
}
