import * as Crypto from "node:crypto";
import { DateTime, Settings } from "luxon";

Settings.throwOnInvalid = true;

export interface Period {
    periodId: string;
    periodEnd: string;
    appSecretPrev: string;
    periodSaltPrev: string;
}

export interface AccessLogRow {
    ipAddress: string;
    userAgent: string;
    date: DateTime<true>;
    path: string;
}

export interface RetentionRow {
    periodId: string;
    userId: string;
    periodEnd: string;
    visitsPrior: Array<{
        periodId: string;
        periodEnd: string;
        requestCount: number;
        sessionLength: number;
    }>
    requestCount: number;
    sessionLength: number
}

export async function getUserId(
    ipAddress: string,
    userAgent: string,
    appSecret: string,
    periodSalt: string,
): Promise<string> {
    const concatenatedString = `${ipAddress}${userAgent}${appSecret}${periodSalt}`;
    return Crypto.createHash("sha256")
        .update(concatenatedString)
        .digest('hex');
}

export async function processLogs(
    accessLog: AccessLogRow[],
    retainedUsers: RetentionRow[],
    config = {
        appSecret: "current",
        periodSalt: "current",
        periodId: "current",
        periodEnd: DateTime.now().toISO(),
        retainedPeriods: <Period[]>[],
    },
): Promise<RetentionRow[]> {
    if (DateTime.now().toMillis() < DateTime.fromISO(config.periodEnd).toMillis()) {
        throw new Error(`Period cannot be in the future. Currently ${config.periodEnd}`);
    }
    if (config.retainedPeriods.length > 0) {
        // `retainedPeriods` should generally be pre-sorted, but double-check for the latest period.
        const latestPeriod = DateTime.max(...config.retainedPeriods.map(period => DateTime.fromISO(period.periodEnd)))!;

        const dayDiff = DateTime.fromISO(config.periodEnd).diff(latestPeriod, 'days').days
        if (dayDiff < 0.9 || dayDiff > 1.1) {
            throw new Error(`Periods should be roughly 1 day apart. Currently ${dayDiff} days apart.`)
        }
    }

    const retainedUsersByUserId = new Map<string, RetentionRow>();
    for (const user of retainedUsers) {
        const isPeriodHashable = !!config.retainedPeriods.find(period => period.periodId === user.periodId);

        if (isPeriodHashable) {
            retainedUsersByUserId.set(user.userId, user);
        }
    }

    console.log(`Dropped ${retainedUsers.length - retainedUsersByUserId.size} users as unhashable`);

    console.log(`Analyzing ${accessLog.length} access log events`);
    const accessLogsByUserId = new Map<string, AccessLogRow[]>();
    for (const log of accessLog) {
        const userId = await getUserId(
            log.ipAddress,
            log.userAgent,
            config.appSecret,
            config.periodSalt
        );

        if (!accessLogsByUserId.has(userId)) {
            accessLogsByUserId.set(userId, []);
        }
        accessLogsByUserId.get(userId)!.push(log);
    }

    console.log(`Grouped ${accessLogsByUserId.size} unique visitors`);

    let iReturned = 0;
    const newUsers = <RetentionRow[]>[];
    for (const [userId, logs] of accessLogsByUserId) {
        const dates = logs.map(log => log.date);

        const firstSeen = DateTime.min(...dates)!;
        const lastSeen = DateTime.max(...dates)!;

        const sessionLength = lastSeen.diff(firstSeen, 'seconds').seconds;

        let existingUser: RetentionRow | undefined = undefined;
        for (const period of config.retainedPeriods) {
            const previousUserId = await getUserId(
                logs[0].ipAddress,
                logs[0].userAgent,
                period.appSecretPrev,
                period.periodSaltPrev
            );

            existingUser = retainedUsersByUserId.get(previousUserId);
            if (existingUser) {
                break;
            }
        }

        if (existingUser) {
            iReturned++;
            newUsers.push({
                periodId: config.periodId,
                userId,
                periodEnd: config.periodEnd,
                visitsPrior: [...existingUser.visitsPrior, {
                    periodId: existingUser.periodId,
                    periodEnd: existingUser.periodEnd,
                    requestCount: existingUser.requestCount,
                    sessionLength: existingUser.sessionLength,
                }],
                requestCount: logs.length,
                sessionLength,
            })
        } else {
            newUsers.push({
                periodId: config.periodId,
                userId,
                periodEnd: config.periodEnd,
                visitsPrior: [],
                requestCount: logs.length,
                sessionLength
            });
        }
    }

    console.log(`Linked ${iReturned} returning visitors.`);


    return newUsers;
}
