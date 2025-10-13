export interface AccessLogRow {
    ipAddress: string;
    userAgent: string;
    date: Date;
    path: string;
}

export interface RetentionRow {
    periodStart: Date;
    periodUserId: string;
    firstSeen: Date;
    lastSeen: Date;
    requestCount: number;
}

export async function getUserId(
    ipAddress: string,
    userAgent: string,
    appSecret: string,
    periodSalt: string,
): Promise<string> {
    // todo- Sha256 of parameters
    return "tbd";
}

export async function processLogs(
    accessLog: AccessLogRow[],
    retainedUsers: RetentionRow[],
    config = {
        appSecret: "current",
        periodSalt: "current",
        retainedPeriods: [{
            appSecretPrev: "previous", // only different if this is the first period after key rotation
            periodSaltPrev: "previous",
        }],
    },
): Promise<RetentionRow[]> {
    // todo:
    // 1. hash and group each accessLog by `[ip + ua] + appSecret + periodSalt`
    // 2. foreach retainedPeriods, lookup each retainedUser by `[ip + ua] + appSecretPrev + periodSaltPrev`, replace `firstSeen` and break if matched
    // 3. return updated retention data
    return [];
}
