import {CloudWatchLogs} from "@aws-sdk/client-cloudwatch-logs";
import {SNS} from "@aws-sdk/client-sns";
import Zlib from "zlib";

const clientCWL = new CloudWatchLogs();
const clientSNS = new SNS();

function findMatch(messages: string[], regex: RegExp) {
    for (const message of messages) {
        const match = regex.exec(message);
        if (match) return match;
    }
    return null;
}

export async function handler(event: any) {
    const config = {
        notificationTopic: process.env.NOTIFICATION_TOPIC_ARN,
        logGroupArn: process.env.LOG_GROUP_ARN?.replace(/:\*$/, ''),
    };

    if (!config.notificationTopic || !config.logGroupArn) {
        throw new Error(`Required EnvVars not configured: ${JSON.stringify(config)}`);
    }

    const payload = Buffer.from(event.awslogs.data, 'base64');
    const logEvent = JSON.parse(Zlib.gunzipSync(payload).toString());

    const logs = await clientCWL.getLogEvents({
        logGroupName: logEvent.logGroup,
        logStreamName: logEvent.logStream,
    })

    if (!logs.events?.length) {
        throw new Error(`No log events found for log group '${config.logGroupArn}'`);
    }

    const logsByRun = Object.groupBy(logs.events.flatMap((log) => {
        const awsMessage = log.message!;
        const [,, run,, message] = awsMessage.match(/^(START|END) RequestId: ([a-f0-9\-]+)/)
        ?? awsMessage.match(/^([\d:\-.TZ]{24})\t([a-f0-9\-]+)\t(ERROR\tInvoke Error )\t(.*)/)
        ?? awsMessage.match(/^([\d:\-.TZ]{24})\t([a-f0-9\-]+)\t(INFO|ERROR)\t(.*)/)
        ?? [];
        return (run && message) ? [[run, message]] : [];
    }), ([run]) => run);

    let errorMessage: string | undefined;
    let successMessage: string | undefined;
    if (Object.keys(logsByRun).length === 0) {
        errorMessage = `Log processor did not run in last 1 day`;
    } else {
        const messages = Object.values(logsByRun)[0]!.map(([,message]) => {
            try { return JSON.parse(message) }
            catch (e) { return message; }
        });

        const error = messages.find((data) =>  !!data.errorType);
        if (error) errorMessage = error.errorMessage;
        else if (!messages.includes('Done!')) errorMessage = 'Unexpected error'
        else {
            const [,start, end] = findMatch(messages, /Getting access logs for ([\d:\-.TZ ]{24,30}) to ([\d:\-.TZ ]{24,30})/) ?? [];
            const [,accessLogVolume] = findMatch(messages, /Analyzing (\d+) access log events/) ?? [];
            const [,returningVisitors] = findMatch(messages, /Linked (\d+) returning visitors/) ?? [];
            const [,uniqueVisitors] = findMatch(messages, /Grouped (\d+) unique visitors/) ?? [];
            const [,wcusConsumed] = findMatch(messages, /Consumed (\d+) WCUs/) ?? [];

            successMessage = `Successfully processed ${accessLogVolume} access logs:
- ${uniqueVisitors} unique visitors
- ${returningVisitors} are returning visitors
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
