import * as Crypto from "node:crypto";
import {CloudWatchLogs} from "@aws-sdk/client-cloudwatch-logs";
import {DynamoDB} from "@aws-sdk/client-dynamodb";
import {DateTime, Duration} from "luxon";
import {mapLimit} from "async";
import {AccessLogRow, Period, processLogs, RetentionRow} from "../Processor.js";
import type {
    GetQueryResultsCommandOutput
} from "@aws-sdk/client-cloudwatch-logs/dist-types/commands/GetQueryResultsCommand.js";

const clientDDB = new DynamoDB();
const clientCWL = new CloudWatchLogs();

async function getRetainedPeriods(tableNamePeriods: string): Promise<Period[]> {
    const periodsPrevDocs = await clientDDB.scan({
        TableName: tableNamePeriods,
    });

    const periodsPrev = periodsPrevDocs.Items?.map((doc): Period => ({
        periodId: `${doc.ApplicationId.S}-${doc.PeriodEnd.S}`,
        periodEnd: DateTime.fromISO(doc.PeriodEnd.S),
        appSecretPrev: "todo-secretsmanager-AWSCURRENT",
        periodSaltPrev: doc.PeriodSalt.S,
    })) ?? [];

    periodsPrev.sort((a, b) => a.periodEnd < b.periodEnd ? -1 : a.periodEnd > b.periodEnd ? 1 : 0);

    return periodsPrev;
}

async function getRetentionUsers(periodsPrev: Period[], tableNameUsers: string): Promise<RetentionRow[]> {
    const userDocs = await Promise.all(periodsPrev.map(async (period) => {
        const periodUsers = await clientDDB.query({
            TableName: tableNameUsers,
            KeyConditionExpression: "PeriodId = :periodId",
            ExpressionAttributeValues: {
                ":periodId": {S: period.periodId},
            },
        });

        return {
            periodId: period.periodId,
            items: periodUsers.Items ?? [],
        };
    }));

    const users = userDocs.flatMap((period) => {
        return period.items.map((user): RetentionRow => ({
            periodId: period.periodId,
            periodUserId: user.UserId.S,
            firstSeen: DateTime.fromISO(user.FirstSeen.S),
            lastSeen: DateTime.fromISO(user.LastSeen.S),
            requestCount: parseInt(user.RequestCount.N),
        }))
    })
    return users;
}

async function getAccessLogs(
    logGroupArn: string,
    start: DateTime,
    end: DateTime,
    filters: string[] = [],
    maxDuration = Duration.fromDurationLike({ hours: 2 }),
): Promise<AccessLogRow[]> {
    const queryString = [
        ...filters,
        'fields @timestamp, `c-ip` as ip, `cs(User-Agent)` as ua, `cs-uri-stem` as path',
        'filter ispresent(ip)',
        'sort @timestamp desc'
    ].join('\n| ');

    const logGroupInfo = await clientCWL.describeLogGroups({
        logGroupIdentifiers: [logGroupArn]
    })

    const creationTime = DateTime.fromMillis(logGroupInfo.logGroups[0].creationTime);
    const retentionEarliest = DateTime.now().minus({ days: logGroupInfo.logGroups[0].retentionInDays });

    const ranges: { start: DateTime, end: DateTime }[] = [];
    let rangeStart = start;

    if (rangeStart < retentionEarliest) {
        rangeStart = retentionEarliest;
    }
    if (rangeStart < creationTime) {
        rangeStart = creationTime;
    }

    while (rangeStart < end) {
        const rangeEnd = rangeStart.plus(maxDuration);
        ranges.push({
            start: rangeStart,
            end: rangeEnd > end ? end : rangeEnd
        });
        rangeStart = rangeEnd;
    }

    const results = await mapLimit(ranges, 5, async (range) => {
        console.log(`Running query ('${range.start.toSQL()}' to '${range.end.toSQL()}'):\n${queryString}`);
        const response = await clientCWL.startQuery({
            logGroupIdentifiers: [logGroupArn],
            queryLanguage: "CWLI",
            startTime: range.start.toUnixInteger(),
            endTime: range.end.toUnixInteger(),
            queryString,
        });

        let queryResults: GetQueryResultsCommandOutput;
        do {
            await new Promise(resolve => setTimeout(resolve, 500));

            queryResults = await clientCWL.getQueryResults({
                queryId: response.queryId
            });
        } while (queryResults.status === 'Running'
            || queryResults.status === 'Scheduled'
            || queryResults.status === 'Unknown');

        if (queryResults.status !== 'Complete') {
            throw new Error(`Query failed: ${queryResults.status}`);
        }

        if (queryResults.statistics.recordsMatched >= 9000) {
            throw new Error(`Query too close, ${queryResults.statistics.recordsMatched}, to limit ('${range.start.toSQL()}' to '${range.end.toSQL()}'). Reduce 'maxDuration' for logs`);
        }

        return queryResults.results?.map(fields => {
            const fieldMap = new Map(fields.map(f => [f.field, f.value]));
            return {
                ipAddress: fieldMap.get('ip'),
                userAgent: fieldMap.get('ua'),
                date: DateTime.fromSQL(fieldMap.get('@timestamp')),
                path: fieldMap.get('path'),
            };
        }) ?? [];
    });

    return results.flat();
}

export async function handler(event) {
    const config = {
        tableNamePeriods: process.env.DYNAMODB_TABLE_PERIODS || "retainless-db-periods",
        tableNameUsers: process.env.DYNAMODB_TABLE_USERS || "retainless-db-users",

        applicationId: process.env.APPLICATION_ID || "retainless-app",
        logGroupArn: process.env.LOG_GROUP_ARN?.replace(/:\*$/, '') || "",
        logStreamName: process.env.LOG_STREAM_NAME,
        logMaxDuration: event.logMaxDuration
            ? Duration.fromDurationLike({ second: event.logMaxDuration })
            : process.env.LOG_MAX_DURATION
                ? Duration.fromDurationLike({ second: Number(process.env.LOG_MAX_DURATION) })
                :  Duration.fromDurationLike({ hours: 2 }),

        periodLength: Number(process.env.PERIOD_LENGTH) || 7,
        periodExpiration: Number(process.env.PERIOD_EXPIRATION) || 4,
        periodEnd: event.periodEnd ? DateTime.fromISO(event.periodEnd) : DateTime.now(),
    };

    console.log(`Loading previous periods`);
    const periodsPrev = await getRetainedPeriods(config.tableNamePeriods);

    const appSecret = `todo-secretsmanager-AWSCURRENT`;
    const appSecretVersion = "$res.SecretVersion";
    const periodStart = periodsPrev.length > 0
        ? periodsPrev[periodsPrev.length - 1].periodEnd
        : config.periodEnd.minus({ day: config.periodLength * config.periodExpiration });
    const periodSalt = Crypto.randomBytes(128).toString('base64');

    console.log(`Loading retained users for ${periodsPrev.length} periods`);
    const users = await getRetentionUsers(periodsPrev, config.tableNameUsers);

    const periodSK = config.periodEnd.toISO();
    const periodId = `${config.applicationId}-${periodSK}`;

    console.log(`Getting access logs for ${periodStart.toISO()} to ${config.periodEnd.toISO()}`);
    const accessLogs = await getAccessLogs(config.logGroupArn, periodStart, config.periodEnd, config.logStreamName ? [
        `filter @logStream = '${config.logStreamName}'`
    ] : [], config.logMaxDuration);

    const retainedUsers = await processLogs(accessLogs, users, {
        appSecret,
        periodSalt,
        periodId,
        retainedPeriods: periodsPrev,
    })
    
    await clientDDB.transactWriteItems({
        TransactItems: [{
            Put: {
                TableName: config.tableNamePeriods,
                Item: {
                    ApplicationId: { S: config.applicationId },
                    PeriodEnd: { S: periodSK },
                    PeriodExpires: { N: `${config.periodEnd.plus({ day: config.periodLength * config.periodExpiration }).toUnixInteger()}` },
                    PeriodSalt: { S: periodSalt },
                    SecretVersion: { S: appSecretVersion },
                }
            }
        }]
    });

    console.log(`Writing ${retainedUsers.length} users to DynamoDB`);
    const TransactItems = retainedUsers.map((user) => ({
        Put: {
            TableName: config.tableNameUsers,
            Item: {
                PeriodId: {S: periodId},
                UserId: {S: user.periodUserId},
                FirstSeen: {S: user.firstSeen.toISO()},
                LastSeen: {S: user.lastSeen.toISO()},
                RequestCount: {N: user.requestCount.toString()},
            }
        }
    }));

    for (let i = 0; i < TransactItems.length; i += 100) {
        const batch = TransactItems.slice(i, i + 100);
        await clientDDB.transactWriteItems({
            TransactItems: batch
        });
    }
}
