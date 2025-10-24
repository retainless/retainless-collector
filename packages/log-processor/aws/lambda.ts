import * as Crypto from "node:crypto";
import {DynamoDB} from "@aws-sdk/client-dynamodb";
import {DateTime, Duration} from "luxon";
import {processLogs} from "../core/Processor.js";
import {DDBPeriod, getRetainedPeriods} from "./Periods.js";
import {DDBUser, getRetentionUsers} from "./RetainedUsers.js";
import {getAccessLogs} from "./AccessLogs.js";
import {CloudWatchLogs} from "@aws-sdk/client-cloudwatch-logs";
import {mapLimit} from "async";

const DEFAULT_TZ = process.env.TZ !== ":UTC"
    ? process.env.TZ
    : 'America/Chicago';

export interface ILogProcessorEvent {
    periodEnd?: string;
    logMaxDuration?: number;
}

const clientDDB = new DynamoDB();
const clientCWL = new CloudWatchLogs();

export async function handler(event: ILogProcessorEvent) {
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
    const periodsPrev = await getRetainedPeriods(clientDDB, config.tableNamePeriods, config.applicationId);

    const appSecret = `todo-secretsmanager-AWSCURRENT`;
    const appSecretVersion = "$res.SecretVersion";
    const periodStart = periodsPrev.length > 0
        ? DateTime.fromISO(periodsPrev[0].periodEnd)
        : config.periodEnd.minus({ day: 1 });
    const periodSalt = Crypto.randomBytes(128).toString('base64');

    console.log(`Loading retained users from previous period`);
    const users = periodsPrev.length > 0
        ? await getRetentionUsers(clientDDB, periodsPrev, config.tableNameUsers)
        : [];

    const periodSK = config.periodEnd.setZone('UTC').toISO()!;
    const periodId = `${config.applicationId}-${periodSK}`;
    const periodExpires = config.periodEnd.plus({ day: config.periodExpiration });

    console.log(`Getting access logs for ${periodStart.toSQL()} to ${config.periodEnd.toSQL()}`);
    const accessLogs = await getAccessLogs(clientCWL, config.logGroupArn, periodStart, config.periodEnd, config.logStreamName ? [
        `filter @logStream = '${config.logStreamName}'`
    ] : [], config.logMaxDuration);

    const retainedUsers = await processLogs(accessLogs, users, {
        appSecret,
        periodSalt,
        periodId,
        periodEnd: periodSK,
        retainedPeriods: periodsPrev,
    })

    const PeriodItem: DDBPeriod = {
        applicationId: { S: config.applicationId },
        periodEnd: { S: periodSK },
        periodExpires: { N: periodExpires.toUnixInteger().toString() },
        salt: { S: periodSalt },
    }

    const TransactItems = retainedUsers.map((user): DDBUser => ({
        periodId: {S: periodId},
        userId: {S: user.userId},
        periodEnd: {S: periodSK},
        ...(user.visitsPrior.length > 0 ? {
            visitsPrior: {
                L: user.visitsPrior.map((visit) => ({
                    M: {
                        periodId: { S: visit.periodId },
                        periodEnd: { S: visit.periodEnd },
                        requestCount: { N: visit.requestCount.toString() },
                        sessionLength: { N: visit.sessionLength.toString() },
                    }
                }))
            },
        } : {}),
        requestCount: {N: user.requestCount.toString()},
        sessionLength: {N: user.sessionLength.toString()}
    }));

    console.log(`Writing ${retainedUsers.length} users to DynamoDB`);
    let WCUsConsumed = 0;
    const chunks = [];
    for (let i = 0; i < TransactItems.length; i += 25) {
        chunks.push(TransactItems.slice(i, i + 25));
    }

    await mapLimit(chunks, 5, async (chunk: DDBUser[]) => {
        await clientDDB.batchWriteItem({
            RequestItems: {
                [config.tableNameUsers]: chunk.map((Item) => ({
                    PutRequest: {Item}
                }))
            },
            ReturnConsumedCapacity: "TOTAL",
        }).then((r) => WCUsConsumed += r.ConsumedCapacity?.[0]?.CapacityUnits ?? 0);
    });

    console.log(`Writing period to DynamoDB`);
    await clientDDB.batchWriteItem({
        RequestItems: {
            [config.tableNamePeriods]: [{
                PutRequest: { Item: PeriodItem },
            }]
        },
        ReturnConsumedCapacity: "TOTAL",
    }).then((r) => WCUsConsumed += r.ConsumedCapacity?.[0]?.CapacityUnits ?? 0);

    console.log(`Consumed ${WCUsConsumed} WCUs`);
    console.log(`Done!`);
}

if (!process.env.ESBUILD) {
    await handler({
        periodEnd: "2025-10-24"
    });
}
