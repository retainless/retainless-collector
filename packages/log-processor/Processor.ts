import * as Crypto from "node:crypto";
import { DateTime, Settings } from "luxon";

Settings.throwOnInvalid = true;

export interface AccessLogRow {
    ipAddress: string;
    userAgent: string;
    date: DateTime;
    path: string;
}

export interface RetentionRow {
    periodStart: DateTime;
    periodUserId: string;
    firstSeen: DateTime;
    lastSeen: DateTime;
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
        periodStart: DateTime.now(),
        retainedPeriods: [{
            appSecretPrev: "previous", // only different if this is the first period after key rotation
            periodSaltPrev: "previous",
        }],
    },
): Promise<RetentionRow[]> {
    // 1. Hash and group access logs by current period user ID
    const currentPeriodGroups = new Map<string, AccessLogRow[]>();

    for (const log of accessLog) {
        const userId = await getUserId(
            log.ipAddress,
            log.userAgent,
            config.appSecret,
            config.periodSalt
        );

        if (!currentPeriodGroups.has(userId)) {
            currentPeriodGroups.set(userId, []);
        }
        currentPeriodGroups.get(userId)!.push(log);
    }

    // Process each group to create/update retention rows
    const updatedRetention: RetentionRow[] = [];

    for (const [periodUserId, logs] of currentPeriodGroups) {
        const dates = logs.map(log => log.date);
        const lastSeen = DateTime.max(...dates) as DateTime;

        let firstSeen = DateTime.min(...dates) as DateTime;
        for (const period of config.retainedPeriods) {
            const previousUserId = await getUserId(
                logs[0].ipAddress,
                logs[0].userAgent,
                period.appSecretPrev,
                period.periodSaltPrev
            );

            const existingUser = retainedUsers.find(u => u.periodUserId === previousUserId);
            if (existingUser) {
                firstSeen = existingUser.firstSeen;
                break;
            }
        }

        updatedRetention.push({
            periodStart: config.periodStart,
            periodUserId,
            firstSeen,
            lastSeen,
            requestCount: logs.length
        });
    }

    return updatedRetention;
}
