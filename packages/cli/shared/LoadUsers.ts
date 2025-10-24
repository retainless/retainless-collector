import {AttributeValue, DynamoDB, QueryCommandOutput, ScanOutput} from "@aws-sdk/client-dynamodb";
import type {DDBUser} from "../../log-processor/aws/RetainedUsers.js";
import * as process from "node:process";
import {DateTime} from "luxon";
import {CLIOptions} from "./CLIOptions.js";

const clientDDB = new DynamoDB();

interface ISearchPeriod {
    periodId: string;
    periodEnd: DateTime;
}

export async function loadPeriods() {
    let LastEvaluatedKey: Record<string, AttributeValue> | undefined = undefined;

    const periods = new Set<ISearchPeriod>();
    do {
        const lastScan: ScanOutput = await clientDDB.scan({
            TableName: "retainless-db-users",
            IndexName: "RetentionForPeriod",
            ProjectionExpression: "periodId,periodEnd",
            Limit: 1,
            ExclusiveStartKey: LastEvaluatedKey
        });

        if (lastScan.Items?.[0]?.periodId?.S && lastScan.Items?.[0]?.periodEnd?.S) {
            periods.add({
                periodId: lastScan.Items[0].periodId.S,
                periodEnd: DateTime.fromISO(lastScan.Items[0].periodEnd.S),
            });
        }

        // https://aws.amazon.com/blogs/database/generate-a-distinct-set-of-partition-keys-for-an-amazon-dynamodb-table-efficiently/
        LastEvaluatedKey = lastScan.LastEvaluatedKey ? {
            periodId: lastScan.LastEvaluatedKey.periodId,
            userId: { S: "ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff" }
        } : undefined;
    } while (LastEvaluatedKey)

    return [...periods].sort((a, b) => a.periodEnd.toMillis() - b.periodEnd.toMillis());
}

export async function loadUsers(
    options: CLIOptions,
): Promise<DDBUser[]> {
    const config = {
        start: DateTime.fromISO(options.start),
        end: DateTime.fromISO(options.end),
    }

    const periodsToSearch = await loadPeriods();

    const usersByPeriod = new Map<string, DDBUser[] | null>();
    for (const period of periodsToSearch) {
        if (period.periodEnd >= config.start && period.periodEnd < config.end) {
            usersByPeriod.set(period.periodId, null);
        }
    }

    if (usersByPeriod.size === 0) {
        throw new Error("Range does not include any users");
    }

    process.stderr.write(`Loading periods`);

    let unfilledPeriods = <string[]>[];
    while ((unfilledPeriods = [...usersByPeriod.entries()]
        .filter(([,v]) => v === null)
        .map(([k]) => k)) && unfilledPeriods.length) {
        for (const periodId of unfilledPeriods) {
            process.stderr.write('.');
            let users = <DDBUser[]>[];
            let LastEvaluatedKey: Record<string, AttributeValue> | undefined = undefined;
            do {
                const response: QueryCommandOutput = await clientDDB.query({
                    TableName: "retainless-db-users",
                    IndexName: "RetentionForPeriod",
                    KeyConditionExpression: "periodId = :periodId",
                    ExpressionAttributeValues: {
                        ":periodId": {S: periodId},
                    },
                    ExclusiveStartKey: LastEvaluatedKey
                });

                if (response.Items) {
                    for (const Item of response.Items) {
                        const user = Item as DDBUser;
                        if (user.visitsPrior) {
                            for (const visitPrior of user.visitsPrior.L) {
                                if (!usersByPeriod.has(visitPrior.M.periodId.S)) {
                                    usersByPeriod.set(visitPrior.M.periodId.S, null);
                                }
                            }
                        }
                        users.push(user);
                    }
                }
                LastEvaluatedKey = response.LastEvaluatedKey;
            } while (LastEvaluatedKey);

            usersByPeriod.set(periodId, users);
        }
    }
    process.stderr.write('\n');

    /***********
     const Crypto = require('node:crypto');
     let ip = '104.210.140.130';
     let ua = 'Mozilla/5.0%20(Macintosh;%20Intel%20Mac%20OS%20X%2010_15_7)%20AppleWebKit/537.36%20(KHTML,%20like%20Gecko)%20Chrome/131.0.0.0%20Safari/537.36;%20compatible;%20OAI-SearchBot/1.0;%20+https://openai.com/searchbot';
     let salt = 'ECnrxYJT0PiPzeeuXfK9Pr71iYZi3BFGbtTmcjV6NyYWFrL4gJJ8YOJzssvUu2TfHneoZGp+MWnF9Lg88KpPS7EiYabJxnIWfwgBkHRxCP10JxrBlbZHVC9cIfFz1LCeWpJ0j1T/gi/L8eacEId7Jthj4BV9rUMrTgAg+M0GPNk=';
     let appSecret = 'todo-secretsmanager-AWSCURRENT';
     Crypto.createHash('sha256').update(`${ip}${ua}${appSecret}${salt}`).digest('hex');
     *************/
    /*
    const tracedUser = [
        "ca3c9ac5963860ac4e247e491922f0ae72e13ca00d7a6ab671c596bb18ce5546",
        "ceacb17c25e6f3ebc16f5f701433b9e914e024839d7068aaaba822d5ec7fecf8",
        "fd6a61ce00a8f5d19008022a931659cb55838852eee44d813ab443d15ba7b9d9",
        "73b3b957a462ac69f2f81d97fa672da8681922c09ff09988014d832df0a7da0e",
        "19b010a1fb962036b3c530ac1d359bd7c76eec0e1402f6140760ef7d591023a3",
        "0f01d6c7afb8f7722d61e1abca5243505cdb7a3b193edd34ad70adacacc91d3f",
        "5123e9f2dc2edeabb482d67b83b8aa53cb8463c34c52f807ec1d17a604abde72",
    ];
    users = users.filter((user) => tracedUser.includes(user.userId.S));

    if (tracedUser.length !== users.length) {
        throw new Error("Not all users were found");
    }
    */

    return [...usersByPeriod.values()].flatMap(v => v !== null ? v : []);
}
