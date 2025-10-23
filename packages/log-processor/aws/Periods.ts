import {AttributeValue, DynamoDB} from "@aws-sdk/client-dynamodb";
import {Period} from "../core/Processor.js";
import {DateTime} from "luxon";

type _DDBDocPeriod<TDoc> = TDoc extends Record<string, AttributeValue> ? TDoc : never;
export type DDBPeriod = _DDBDocPeriod<{
    applicationId: AttributeValue.SMember;
    periodEnd: AttributeValue.SMember;
    periodExpires: AttributeValue.NMember;
    salt: AttributeValue.SMember;
}>

export async function getRetainedPeriods(
    clientDDB: DynamoDB,
    tableNamePeriods: string,
    applicationId = "retainless-app",
): Promise<Period[]> {
    const periodsPrevDocs = await clientDDB.query({
        TableName: tableNamePeriods,
        KeyConditionExpression: "applicationId = :applicationId",
        ExpressionAttributeValues: {
            ":applicationId": {S: applicationId},
        },
    });

    const items = periodsPrevDocs.Items as DDBPeriod[] ?? [];

    const periodsPrev = items.map((doc): Period => ({
        periodId: `${doc.applicationId.S}-${doc.periodEnd.S}`,
        periodEnd: doc.periodEnd.S,
        appSecretPrev: "todo-secretsmanager-AWSCURRENT",
        periodSaltPrev: doc.salt.S,
    })) ?? [];

    periodsPrev.sort((a, b) => b.periodEnd.localeCompare(a.periodEnd));

    return periodsPrev;
}
