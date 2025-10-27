import {DateTime, Duration} from "luxon";
import {AccessLogRow} from "../core/Processor.js";
import {mapLimit} from "async";
import {CloudWatchLogs, GetQueryResultsCommandOutput} from "@aws-sdk/client-cloudwatch-logs";

export async function getAccessLogs(
    clientCWL: CloudWatchLogs,
    logGroupArn: string,
    start: DateTime,
    end: DateTime,
    filters: string[] = [],
    maxDuration = Duration.fromDurationLike({hours: 2}),
): Promise<AccessLogRow[]> {
    const queryString = [
        ...filters,
        'fields @timestamp, `c-ip` as ip, `cs(User-Agent)` as ua, `cs-uri-stem` as path',
        'filter ispresent(ip)',
        'sort @timestamp desc'
    ].join('\n| ');

    console.log(`Using query string:\n${queryString}`);

    const logGroupInfo = await clientCWL.describeLogGroups({
        logGroupIdentifiers: [logGroupArn],
        limit: 1,
    })

    if (logGroupInfo.logGroups?.length !== 1) {
        throw new Error(`Invalid Log Group ARN: ${logGroupArn}`);
    }

    const creationTime = DateTime.fromMillis(logGroupInfo.logGroups[0].creationTime!);
    const retentionEarliest = DateTime.now().minus({days: logGroupInfo.logGroups[0].retentionInDays});

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

    const results = await mapLimit<any, AccessLogRow[]>(ranges, 5, async (range: {
        start: DateTime;
        end: DateTime
    }) => {
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

        if (queryResults.statistics?.recordsMatched === undefined) {
            throw new Error(`Query is invalid.`);
        } else if (queryResults.statistics.recordsMatched >= 9000) {
            throw new Error(`Query too close, ${queryResults.statistics.recordsMatched}, to limit ('${range.start.toSQL()}' to '${range.end.toSQL()}'). Reduce 'maxDuration' for logs`);
        }

        return queryResults.results?.map(fields => {
            const fieldMap = new Map(fields.map(f => [f.field, f.value]));
            return {
                ipAddress: fieldMap.get('ip'),
                userAgent: fieldMap.get('ua'),
                date: DateTime.fromSQL(fieldMap.get('@timestamp')!),
                path: fieldMap.get('path'),
            };
        }) ?? [];
    });

    return results.flat();
}