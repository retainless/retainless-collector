import * as Crypto from "node:crypto";
import {CloudWatchLogs} from "@aws-sdk/client-cloudwatch-logs";
import {AttributeValue, DynamoDB} from "@aws-sdk/client-dynamodb";
import {DateTime, Duration} from "luxon";
import {mapLimit} from "async";
import {AccessLogRow, Period, processLogs, RetentionRow} from "../Processor.js";
import type {
    GetQueryResultsCommandOutput
} from "@aws-sdk/client-cloudwatch-logs/dist-types/commands/GetQueryResultsCommand.js";

const clientDDB = new DynamoDB();
const clientCWL = new CloudWatchLogs();

async function getRetainedPeriods(
    tableNamePeriods: string,
    applicationId = "retainless-app",
): Promise<Period[]> {
    const periodsPrevDocs = await clientDDB.query({
        TableName: tableNamePeriods,
        KeyConditionExpression: "ApplicationId = :applicationId",
        ExpressionAttributeValues: {
            ":applicationId": {S: applicationId},
        },
    });

    const periodsPrev = periodsPrevDocs.Items?.map((doc): Period => ({
        periodId: `${doc.ApplicationId.S}-${doc.PeriodEnd.S}`,
        periodEnd: DateTime.fromISO(doc.PeriodEnd.S),
        appSecretPrev: "todo-secretsmanager-AWSCURRENT",
        periodSaltPrev: doc.PeriodSalt.S,
    })) ?? [];

    periodsPrev.sort((a, b) => a.periodEnd < b.periodEnd ? 1 : a.periodEnd > b.periodEnd ? -1 : 0);

    return periodsPrev;
}

async function getRetentionUsers(
    periodPrev: Period,
    tableNameUsers: string
): Promise<RetentionRow[]> {
    let LastEvaluatedKey: Record<string, AttributeValue>;
    const users: RetentionRow[] = [];

    do {
        const periodUsers = await clientDDB.query({
            TableName: tableNameUsers,
            IndexName: "RetentionForPeriod",
            KeyConditionExpression: "PeriodId = :periodId",
            ExpressionAttributeValues: {
                ":periodId": {S: periodPrev.periodId},
            },
            ExclusiveStartKey: LastEvaluatedKey
        });

        users.push(...periodUsers.Items.map((user): RetentionRow => ({
            periodId: user.UserIdPeriod.S,
            periodUserId: user.UserId.S,
            visitInitial: DateTime.fromISO(user.VisitInitial.S),
            visitsPrior: user.VisitsPrior?.SS.map((visit) => DateTime.fromISO(visit)) ?? [],
            visitLatest: DateTime.fromISO(user.VisitLatest.S),
            requestCount: -1, // not included in GSI
        })));

        LastEvaluatedKey = periodUsers.LastEvaluatedKey;
    } while (LastEvaluatedKey);

    console.log(`Loaded ${users.length} users from previous period`);
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

    console.log(`Using query string:\n${queryString}`);

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

    if (ranges.length === 0) {
        throw new Error(`Empty time periods for log group creation: '${creationTime.toSQL()}', retained to: '${retentionEarliest.toSQL()}'`);
    }

    const results = await mapLimit(ranges, 5, async (range) => {
        console.log(`Running query ('${range.start.toSQL()}' to '${range.end.toSQL()}')`);
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

const DEFAULT_TZ = process.env.TZ !== ":UTC"
    ? process.env.TZ
    : 'America/Chicago';

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

        periodExpiration: Number(process.env.PERIOD_EXPIRATION) || 30,
        periodEnd: event.periodEnd
            ? DateTime.fromISO(event.periodEnd, { zone: DEFAULT_TZ })
            : DateTime.local({ zone: DEFAULT_TZ }).startOf('day'),
    };

    console.log(JSON.stringify(config));
    console.log(`Loading previous periods`);
    const periodsPrev = await getRetainedPeriods(config.tableNamePeriods, config.applicationId);

    const appSecret = `todo-secretsmanager-AWSCURRENT`;
    const appSecretVersion = "$res.SecretVersion";
    const periodStart = periodsPrev.length > 0
        ? periodsPrev[0].periodEnd
        : config.periodEnd.minus({ day: 1 });
    const periodSalt = Crypto.randomBytes(128).toString('base64');

    console.log(`Loading retained users from previous period`);
    const users = periodsPrev.length > 0
        ? await getRetentionUsers(periodsPrev[0], config.tableNameUsers)
        : [];

    const periodSK = config.periodEnd.setZone('UTC').toISO();
    const periodId = `${config.applicationId}-${periodSK}`;
    const periodExpires = config.periodEnd.plus({ day: config.periodExpiration });

    console.log(`Getting access logs for ${periodStart.toSQL()} to ${config.periodEnd.toSQL()}`);
    const accessLogs = await getAccessLogs(config.logGroupArn, periodStart, config.periodEnd, config.logStreamName ? [
        `filter @logStream = '${config.logStreamName}'`
    ] : [], config.logMaxDuration);

    const retainedUsers = await processLogs(accessLogs, users, {
        appSecret,
        periodSalt,
        periodId,
        retainedPeriods: periodsPrev,
    })

    console.log(`Writing period to DynamoDB`);
    await clientDDB.transactWriteItems({
        TransactItems: [{
            Put: {
                TableName: config.tableNamePeriods,
                Item: {
                    ApplicationId: { S: config.applicationId },
                    PeriodEnd: { S: periodSK },
                    PeriodExpires: { N: periodExpires.toUnixInteger().toString() },
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
                UserIdPeriod: {S: user.periodId},
                VisitInitial: {S: user.visitInitial.setZone('UTC').toISO()},
                ...(user.visitsPrior.length > 0 ? {
                    VisitsPrior: {SS: user.visitsPrior.map((visit) => visit.setZone('UTC').toISO())},
                } : {}),
                VisitLatest: {S: user.visitLatest.setZone('UTC').toISO()},
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

    console.log(`Done!`);
}

if (!process.env.ESBUILD) {
    await handler({
        periodEnd: "2025-10-17T05:00:00Z"
    });
}
