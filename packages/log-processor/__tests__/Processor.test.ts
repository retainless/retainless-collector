import {AccessLogRow, getUserId, processLogs, RetentionRow} from "../Processor";

describe("Processor", () => {
    const config: Parameters<typeof processLogs>[2] = {
        appSecret: "appSecret",
        periodSalt: "periodSalt",
        retainedPeriods: [{
            appSecretPrev: "appSecretPrev",
            periodSaltPrev: "periodSaltPrev",
        }],
    };

    it("adds new users", async () => {
        const accessLog: AccessLogRow[] = [{
            ipAddress: "0.0.0.0",
            userAgent: "Firefox",
            date: new Date(),
            path: "/my/site?q=hi",
        }, {
            ipAddress: "0.0.0.0",
            userAgent: "Firefox",
            date: new Date(),
            path: "/my/site?q=bye",
        }];
        const retainedUsers: RetentionRow[] = [];

        const result = await processLogs(accessLog, retainedUsers, config);

        expect(result).toMatchObject([{
            periodStart: new Date(),
            periodUserId: await getUserId("0.0.0.0", "Firefox", "appSecret", "periodSalt"),
            firstSeen: accessLog[0].date,
            lastSeen: accessLog[0].date,
            requestCount: 2,
        }]);
    });

    it("links returning users", async () => {
        const accessLog: AccessLogRow[] = [{
            ipAddress: "0.0.0.0",
            userAgent: "Firefox",
            date: new Date(),
            path: "/my/site?q=hi",
        }, {
            ipAddress: "0.0.0.0",
            userAgent: "Firefox",
            date: new Date(),
            path: "/my/site?q=bye",
        }];
        const retainedUsers: RetentionRow[] = [{
            periodStart: new Date(),
            periodUserId: await getUserId("0.0.0.0", "Firefox", "appSecretPrev", "periodSaltPrev"),
            firstSeen: new Date(2025, 1, 1),
            lastSeen: new Date(2025, 2, 1),
            requestCount: 4,
        }];

        const result = await processLogs(accessLog, retainedUsers, config);

        expect(result).toMatchObject([{
            periodStart: new Date(),
            periodUserId: await getUserId("0.0.0.0", "Firefox", "appSecret", "periodSalt"),
            firstSeen: retainedUsers[0].firstSeen,
            lastSeen: accessLog[0].date,
            requestCount: 2,
        }]);
    });

    it("adds and links users", async () => {
        const accessLog: AccessLogRow[] = [{
            ipAddress: "1.1.1.1",
            userAgent: "Chrome",
            date: new Date(),
            path: "/page1",
        }, {
            ipAddress: "0.0.0.0",
            userAgent: "Firefox",
            date: new Date(),
            path: "/page2",
        }];
        const retainedUsers: RetentionRow[] = [{
            periodStart: new Date(),
            periodUserId: await getUserId("0.0.0.0", "Firefox", "appSecretPrev", "periodSaltPrev"),
            firstSeen: new Date(2025, 1, 1),
            lastSeen: new Date(2025, 2, 1),
            requestCount: 4,
        }];

        const result = await processLogs(accessLog, retainedUsers, config);

        expect(result).toMatchObject([{
            periodStart: new Date(),
            periodUserId: await getUserId("1.1.1.1", "Chrome", "appSecret", "periodSalt"),
            firstSeen: accessLog[0].date,
            lastSeen: accessLog[0].date,
            requestCount: 1,
        }, {
            periodStart: new Date(),
            periodUserId: await getUserId("0.0.0.0", "Firefox", "appSecret", "periodSalt"),
            firstSeen: retainedUsers[0].firstSeen,
            lastSeen: accessLog[1].date,
            requestCount: 1,
        }]);
    });
});
