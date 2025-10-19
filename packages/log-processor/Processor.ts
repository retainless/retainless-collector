import * as Crypto from "node:crypto";
import { DateTime, Settings } from "luxon";

Settings.throwOnInvalid = true;

export interface Period {
    periodId: string;
    periodEnd: DateTime;
    appSecretPrev: string;
    periodSaltPrev: string;
}

export interface AccessLogRow {
    ipAddress: string;
    userAgent: string;
    date: DateTime;
    path: string;
}

export interface RetentionRow {
    periodId: string;
    periodUserId: string;
    visitInitial: DateTime;
    visitsPrior: DateTime[];
    visitLatest: DateTime;
    requestCount: number;
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
        periodId: DateTime.now().toISO(),
        retainedPeriods: <Period[]>[],
    },
): Promise<RetentionRow[]> {
    const retainedUsersByUserId = new Map<string, RetentionRow>();
    for (const user of retainedUsers) {
        const isPeriodHashable = !!config.retainedPeriods.find(period => period.periodId === user.periodId);

        if (isPeriodHashable) {
            retainedUsersByUserId.set(user.periodUserId, {
                ...user,
                requestCount: 0,
            });
        }
    }

    console.log(`Dropping ${retainedUsers.length - retainedUsersByUserId.size} users as unhashable.`);

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

    for (const [periodUserId, logs] of accessLogsByUserId) {
        const dates = logs.map(log => log.date);
        const lastSeen = DateTime.max(...dates) as DateTime;

        let existingUser: RetentionRow;
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
            retainedUsersByUserId.set(existingUser.periodUserId, {
                periodId: config.periodId,
                periodUserId,
                visitInitial: existingUser.visitInitial,
                visitsPrior: [...existingUser.visitsPrior, existingUser.visitLatest],
                visitLatest: lastSeen,
                requestCount: logs.length,
            })
        } else {
            const firstSeen = DateTime.min(...dates) as DateTime;

            retainedUsersByUserId.set(periodUserId, {
                periodId: config.periodId,
                periodUserId,
                visitInitial: firstSeen,
                visitsPrior: [],
                visitLatest: lastSeen,
                requestCount: logs.length,
            });
        }
    }

    return [...retainedUsersByUserId.values()];
}
