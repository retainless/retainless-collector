import {Period, RetentionRow} from "../core/Processor.js";
import {AttributeValue, DynamoDB, QueryCommandOutput} from "@aws-sdk/client-dynamodb";

type _DDBDocUser<TDoc> = TDoc extends Partial<Record<keyof RetentionRow, AttributeValue>> ? TDoc : never;
export type DDBUser = _DDBDocUser<{
    periodId: AttributeValue.SMember;
    userId: AttributeValue.SMember;
    periodEnd: AttributeValue.SMember;
    visitsPrior?: {
        L: {
            M: {
                periodId: { S: string; }
                periodEnd: { S: string };
                requestCount: { N: string };
                sessionLength: { N: string };
            }
        }[]
    };
    requestCount: AttributeValue.NMember;
    sessionLength: AttributeValue.NMember;
}>;

export async function getRetentionUsers(
    clientDDB: DynamoDB,
    periodsPrev: Period[],
    tableNameUsers: string
): Promise<RetentionRow[]> {
    const users: RetentionRow[] = [];

    for (const period of periodsPrev) {
        let LastEvaluatedKey: Record<string, AttributeValue> | undefined = undefined;
        do {
            const periodUsers: QueryCommandOutput = await clientDDB.query({
                TableName: tableNameUsers,
                IndexName: "RetentionForPeriod",
                KeyConditionExpression: "periodId = :periodId",
                ExpressionAttributeValues: {
                    ":periodId": {S: period.periodId},
                },
                ExclusiveStartKey: LastEvaluatedKey
            });

            const items = periodUsers.Items as DDBUser[] ?? [];

            users.push(...items.map((user): RetentionRow => ({
                periodId: user.periodId.S,
                userId: user.userId.S,
                periodEnd: user.periodEnd.S,
                visitsPrior: user.visitsPrior?.L.map((visit) => ({
                    periodId: visit.M.periodId.S,
                    periodEnd: visit.M.periodEnd.S,
                    requestCount: Number(visit.M.requestCount.N),
                    sessionLength: Number(visit.M.sessionLength.N),
                })) ?? [],
                requestCount: Number(user.requestCount.N),
                sessionLength: Number(user.sessionLength.N),
            })));

            LastEvaluatedKey = periodUsers.LastEvaluatedKey;
        } while (LastEvaluatedKey);
    }

    console.log(`Loaded ${users.length} users from previous periods`);
    return users;
}
