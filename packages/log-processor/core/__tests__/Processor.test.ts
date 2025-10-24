import "jest";
import {AccessLogRow, getUserId, processLogs, RetentionRow} from "../Processor.js";
import {DateTime} from "luxon";

import '../../LuxonConfigure.js';

describe("Processor", () => {
    const config: Parameters<typeof processLogs>[2] = {
        appSecret: "appSecret",
        periodSalt: "periodSalt",
        periodId: "B",
        periodEnd: "2025-10-02T00:00:00.000Z",
        retainedPeriods: [{
            periodId: "A",
            periodEnd: "2025-10-01T00:00:00.000Z",
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
            userId: await getUserId("0.0.0.0", "Firefox", "appSecret", "periodSalt"),
            periodEnd: "2025-10-02T00:00:00.000Z",
            visitsPrior: [],
            requestCount: 2,
            sessionLength: 60,
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
            userId: await getUserId("0.0.0.0", "Firefox", "appSecretPrev", "periodSaltPrev"),
            periodEnd: "2025-10-02T00:00:00.000Z",
            visitsPrior: [],
            requestCount: 4,
            sessionLength: 60,
        }];

        const result = await processLogs(accessLog, retainedUsers, config);

        expect(result).toMatchObject([{
            periodId: "B",
            userId: await getUserId("0.0.0.0", "Firefox", "appSecret", "periodSalt"),
            periodEnd: "2025-10-02T00:00:00.000Z",
            visitsPrior: [],
            requestCount: 2,
            sessionLength: 60,
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
            userId: await getUserId("0.0.0.0", "Firefox", "appSecretPrev", "periodSaltPrev"),
            periodEnd: "2025-10-01T00:00:00.000Z",
            visitsPrior: [],
            requestCount: 4,
            sessionLength: 60,
        }];

        const result = await processLogs(accessLog, retainedUsers, config);

        expect(result).toMatchObject([{
            periodId: "B",
            userId: await getUserId("1.1.1.1", "Chrome", "appSecret", "periodSalt"),
            periodEnd: "2025-10-02T00:00:00.000Z",
            visitsPrior: [],
            requestCount: 1,
            sessionLength: 0,
        }, {
            periodId: "B",
            userId: await getUserId("0.0.0.0", "Firefox", "appSecret", "periodSalt"),
            periodEnd: "2025-10-02T00:00:00.000Z",
            visitsPrior: [{
                periodId: "A",
                periodEnd: "2025-10-01T00:00:00.000Z",
                requestCount: 4,
                sessionLength: 60,
            }],
            requestCount: 1,
            sessionLength: 0,
        }]);
    });
});
