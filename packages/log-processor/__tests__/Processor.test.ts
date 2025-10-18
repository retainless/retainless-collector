import "jest";
import {AccessLogRow, getUserId, processLogs, RetentionRow} from "../Processor";
import {DateTime} from "luxon";

declare module 'luxon' {
    interface TSSettings {
        throwOnInvalid: true
    }
}

describe("Processor", () => {
    const config: Parameters<typeof processLogs>[2] = {
        appSecret: "appSecret",
        periodSalt: "periodSalt",
        periodId: "B",
        retainedPeriods: [{
            periodId: "A",
            periodEnd: DateTime.fromISO("2025-12-31T00:00:00.000Z"),
            appSecretPrev: "appSecretPrev",
            periodSaltPrev: "periodSaltPrev",
        }],
    };

    it("adds new users", async () => {
        const accessLog: AccessLogRow[] = [{
            ipAddress: "0.0.0.0",
            userAgent: "Firefox",
            date: DateTime.fromISO("2025-01-02T11:01:00.000Z"),
            path: "/my/site?q=hi",
        }, {
            ipAddress: "0.0.0.0",
            userAgent: "Firefox",
            date: DateTime.fromISO("2025-01-02T11:02:00.000Z"),
            path: "/my/site?q=bye",
        }];
        const retainedUsers: RetentionRow[] = [];

        const result = await processLogs(accessLog, retainedUsers, config);

        expect(result).toMatchObject([{
            periodId: "B",
            periodUserId: await getUserId("0.0.0.0", "Firefox", "appSecret", "periodSalt"),
            firstSeen: DateTime.fromISO("2025-01-02T11:01:00.000Z"),
            lastSeen: DateTime.fromISO("2025-01-02T11:02:00.000Z"),
            requestCount: 2,
        }]);
    });

    it("links returning users", async () => {
        const accessLog: AccessLogRow[] = [{
            ipAddress: "0.0.0.0",
            userAgent: "Firefox",
            date: DateTime.fromISO("2025-01-02T11:01:00.000Z"),
            path: "/my/site?q=hi",
        }, {
            ipAddress: "0.0.0.0",
            userAgent: "Firefox",
            date: DateTime.fromISO("2025-01-02T11:02:00.000Z"),
            path: "/my/site?q=bye",
        }];
        const retainedUsers: RetentionRow[] = [{
            periodId: "B",
            periodUserId: await getUserId("0.0.0.0", "Firefox", "appSecretPrev", "periodSaltPrev"),
            firstSeen: DateTime.fromISO("2025-12-28T06:01:00.000Z"),
            lastSeen: DateTime.fromISO("2025-12-30T07:01:00.000Z"),
            requestCount: 4,
        }];

        const result = await processLogs(accessLog, retainedUsers, config);

        expect(result).toMatchObject([{
            periodId: "B",
            periodUserId: await getUserId("0.0.0.0", "Firefox", "appSecret", "periodSalt"),
            firstSeen: DateTime.fromISO("2025-12-28T06:01:00.000Z"),
            lastSeen: DateTime.fromISO("2025-01-02T11:02:00.000Z"),
            requestCount: 2,
        }]);
    });

    it("adds and links users", async () => {
        const accessLog: AccessLogRow[] = [{
            ipAddress: "1.1.1.1",
            userAgent: "Chrome",
            date: DateTime.fromISO("2025-01-02T11:01:00.000Z"),
            path: "/page1",
        }, {
            ipAddress: "0.0.0.0",
            userAgent: "Firefox",
            date: DateTime.fromISO("2025-01-02T11:02:00.000Z"),
            path: "/page2",
        }];
        const retainedUsers: RetentionRow[] = [{
            periodId: "A",
            periodUserId: await getUserId("0.0.0.0", "Firefox", "appSecretPrev", "periodSaltPrev"),
            firstSeen: DateTime.fromISO("2025-12-28T06:01:00.000Z"),
            lastSeen: DateTime.fromISO("2025-12-30T07:01:00.000Z"),
            requestCount: 4,
        }];

        const result = await processLogs(accessLog, retainedUsers, config);

        expect(result).toMatchObject([{
            periodId: "B",
            periodUserId: await getUserId("1.1.1.1", "Chrome", "appSecret", "periodSalt"),
            firstSeen: DateTime.fromISO("2025-01-02T11:01:00.000Z"),
            lastSeen: DateTime.fromISO("2025-01-02T11:01:00.000Z"),
            requestCount: 1,
        }, {
            periodId: "B",
            periodUserId: await getUserId("0.0.0.0", "Firefox", "appSecret", "periodSalt"),
            firstSeen: DateTime.fromISO("2025-12-28T06:01:00.000Z"),
            lastSeen: DateTime.fromISO("2025-01-02T11:02:00.000Z"),
            requestCount: 1,
        }]);
    });
});
