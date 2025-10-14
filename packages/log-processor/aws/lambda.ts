import {CloudWatchLogs} from "@aws-sdk/client-cloudwatch-logs";
import {DynamoDB} from "@aws-sdk/client-dynamodb";

const clientDDB = new DynamoDB();
const clientCWL = new CloudWatchLogs();

export async function handler() {
    const config = {
        tableNamePeriods: process.env.DYNAMODB_TABLE_PERIODS || "retainless-db-periods",
    };

    const periodsPrev = await clientDDB.scan({
        TableName: config.tableNamePeriods,
    })
}
