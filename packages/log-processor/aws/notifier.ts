import {getLogs} from "./AccessLogs.js";
import {CloudWatchLogs} from "@aws-sdk/client-cloudwatch-logs";
import {DateTime, Duration} from "luxon";
import {SNS} from "@aws-sdk/client-sns";

const clientCWL = new CloudWatchLogs();
const clientSNS = new SNS();

function findMatch(messages: string[], regex: RegExp) {
    for (const message of messages) {
        const match = regex.exec(message);
        if (match) return match;
    }
    return null;
}

export async function handler() {
    const config = {
        notificationTopic: process.env.NOTIFICATION_TOPIC_ARN,
        logGroupArn: process.env.LOG_GROUP_ARN?.replace(/:\*$/, ''),
    };

    if (!config.notificationTopic || !config.logGroupArn) {
        throw new Error(`Required EnvVars not configured: ${JSON.stringify(config)}`);
    }

    const searchEnd = DateTime.now();
    const searchStart = searchEnd.minus({day: 1});
    const logs = await getLogs(clientCWL, config.logGroupArn, searchStart, searchEnd, [
        `fields @timestamp, @message`,
        `sort @timestamp desc`,
    ].join(' |\n'), Duration.fromObject({ days: 14 }));

    const logsByRun = Object.groupBy(logs.flatMap((fields) => {
        const fieldMap = new Map(fields.map(f => [f.field, f.value]));
        const output = fieldMap.get("@message")!;
        const [,, run,, message] = output.match(/^(START|END) RequestId: ([a-f0-9\-]+)/)
        ?? output.match(/^([\d:\-.TZ]{24})\t([a-f0-9\-]+)\t(ERROR\tInvoke Error )\t(.*)/)
        ?? output.match(/^([\d:\-.TZ]{24})\t([a-f0-9\-]+)\t(INFO|ERROR)\t(.*)/)
        ?? [];
        return (run && message) ? [[run, message]] : [];
    }), ([run]) => run);

    let errorMessage: string | undefined;
    let successMessage: string | undefined;
    if (Object.keys(logsByRun).length !== 1) {
        errorMessage = `Unexpected number of runs: ${logsByRun.size}`;
    } else {
        const messages = Object.values(logsByRun)[0]!.map(([,message]) => {
            try { return JSON.parse(message) }
            catch (e) { return message; }
        });

        const error = messages.find((data) =>  !!data.errorType);
        if (error) errorMessage = error.errorMessage;
        else if (!messages.includes('Done!')) errorMessage = 'Unexpected error'
        else {
            const [,accessLogVolume] = findMatch(messages, /Hashing (\d+) access logs by user/) ?? [];
            const [,uniqueVisitors] = findMatch(messages, /Linking (\d+) unique visitors to previous sessions/) ?? [];
            const [,start, end] = findMatch(messages, /Getting access logs for ([\d:\-.TZ ]{24,30}) to ([\d:\-.TZ ]{24,30})/) ?? [];
            const [,wcusConsumed] = findMatch(messages, /Consumed (\d+) WCUs/) ?? [];

            successMessage = `Successfully processed ${accessLogVolume} access logs:
- ${uniqueVisitors} unique visitors
- ${wcusConsumed} WCUs consumed
/ From: ${start}
/ To: ${end}`;
        }
    }

    if (errorMessage) {
        console.log(`Publishing ${errorMessage} error.`);
        await clientSNS.publish({
            TopicArn: config.notificationTopic,
            Subject: 'Retainless Processing Error',
            Message: `An error occurred when processing daily access logs:
${errorMessage}

Please investigate and report a GitHub issue at:
https://github.com/retainless/retainless-collector/issues`,
        })
    } else if (successMessage) {
        console.log(`Publishing success notification.`);
        await clientSNS.publish({
            TopicArn: config.notificationTopic,
            Subject: 'Retainless Results',
            Message: `${successMessage}

Use Retainless to view your app analytics.`,
        })
    } else {
        throw new Error("Error parsing success or failure results");
    }
}
