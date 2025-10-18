import * as Crypto from "node:crypto";
import {CloudWatchLogs} from "@aws-sdk/client-cloudwatch-logs";
import {DynamoDB} from "@aws-sdk/client-dynamodb";
import {DateTime} from "luxon";
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
): Promise<AccessLogRow[]> {
    const response = await clientCWL.startQuery({
        logGroupIdentifiers: [
            logGroupArn.replace(/:\*$/, '')
        ],
        queryLanguage: "CWLI",
        startTime: start.toUnixInteger(),
        endTime: end.toUnixInteger(),
        queryString: [
            ...filters,
            'fields @timestamp, `c-ip` as ip, `cs(User-Agent)` as ua, `cs-uri-stem` as path',
            'sort @timestamp desc'
        ].join('\n| '),
    });

    let results: GetQueryResultsCommandOutput;
    do {
        results = await clientCWL.getQueryResults({
            queryId: response.queryId
        });

        if (results.status === 'Running'
            || results.status === 'Scheduled'
            || results.status === 'Unknown') {
            await new Promise(resolve => setTimeout(resolve, 1000));
        }
    } while (results.status === 'Running');

    const logs = results.results?.map(fields => {
        const fieldMap = new Map(fields.map(f => [f.field, f.value]));
        return {
            ipAddress: fieldMap.get('ip'),
            userAgent: fieldMap.get('ua'),
            date: DateTime.fromSQL(fieldMap.get('@timestamp')),
            path: fieldMap.get('path'),
        };
    }) ?? [];

    return logs;
}

export async function handler(event) {
    const config = {
        tableNamePeriods: process.env.DYNAMODB_TABLE_PERIODS || "retainless-db-periods",
        tableNameUsers: process.env.DYNAMODB_TABLE_USERS || "retainless-db-users",

        applicationId: process.env.APPLICATION_ID || "retainless-app",
        logGroupArn: process.env.LOG_GROUP_ARN || "",
        logStreamName: process.env.LOG_STREAM_NAME,

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
    ] : []);

    const retainedUsers = await processLogs(accessLogs, users, {
        appSecret,
        periodSalt,
        periodId,
        retainedPeriods: periodsPrev,
    })

    console.log(`Writing ${retainedUsers.length} users to DynamoDB`);
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
        }, ...retainedUsers.map((user) => ({
            Put: {
                TableName: config.tableNameUsers,
                Item: {
                    PeriodId: { S: periodId },
                    UserId: { S: user.periodUserId },
                    FirstSeen: { S: user.firstSeen.toISO() },
                    LastSeen: { S: user.lastSeen.toISO() },
                    RequestCount: { N: user.requestCount.toString() },
                }
            }
        }))]
    })
}
