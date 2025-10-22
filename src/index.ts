import axios from 'axios';
import * as yaml from 'js-yaml';
import * as fs from 'fs';
import dayjs from 'dayjs';
import dotenv from 'dotenv';
import { SSMClient, GetParameterCommand } from '@aws-sdk/client-ssm';
import { shouldRunForSchedule } from './utils/cronMatcher';
import { Config, Team } from './types';

dotenv.config();

const userNameCache = new Map<string, string>();

async function getGitHubDisplayName(username: string, GITHUB_TOKEN: string): Promise<string> {
    if (userNameCache.has(username)) {
        return userNameCache.get(username)!;
    }

    try {
        const res = await axios.get(`https://api.github.com/users/${username}`, {
            headers: {
                Authorization: `Bearer ${GITHUB_TOKEN}`,
                Accept: 'application/vnd.github+json',
            },
        });

        const name = res.data.name || username;
        userNameCache.set(username, name);
        return name;
    } catch (err) {
        console.warn(`Failed to fetch display name for ${username}, using login.`);
        return username;
    }
}

async function getSecret(name: string): Promise<string | undefined> {
    try {
        const client = new SSMClient({ region: process.env.AWS_REGION || 'eu-west-1' });
        const command = new GetParameterCommand({ Name: name, WithDecryption: true });
        const response = await client.send(command);
        return response.Parameter?.Value;
    } catch (error) {
        console.error(`Error retrieving secret ${name}:`, error);
        return undefined;
    }
}

async function getOpenPRs(repo: string, org: string, token: string) {
    const url = `https://api.github.com/repos/${org}/${repo}/pulls?state=open&per_page=100`;
    const response = await axios.get(url, {
        headers: {
            Authorization: `Bearer ${token}`,
            Accept: 'application/vnd.github+json',
        },
    });
    return response.data;
}

async function sendSlackMessage(channel: string, blocks: any, slackToken: string) {
    await axios.post('https://slack.com/api/chat.postMessage', {
        channel,
        blocks,
    }, {
        headers: {
            Authorization: `Bearer ${slackToken}`,
            'Content-Type': 'application/json',
        },
    });
}

async function buildSlackBlocks(team: Team, prsByRepo: Record<string, any[]>, GITHUB_TOKEN: string) {
    const blocks: any[] = [
        {
            type: 'header',
            text: {
                type: 'plain_text',
                text: `🔔 Open PRs for ${team.name}`,
                emoji: true,
            },
        },
        { type: 'divider' },
    ];

    for (const repo of Object.keys(prsByRepo)) {
        blocks.push({
            type: 'section',
            text: {
                type: 'mrkdwn',
                text: `📦 *Repository:* *${repo}*`,
            },
        });

        for (const pr of prsByRepo[repo]) {
            const createdAt = dayjs(pr.created_at);
            const daysOpen = dayjs().diff(createdAt, 'day');
            const colorEmoji = daysOpen >= 10 ? ':red_circle:' : daysOpen >= 5 ? ':large_orange_circle:' : ':large_green_circle:';
            const author = await getGitHubDisplayName(pr.user.login, GITHUB_TOKEN);


            blocks.push({
                type: 'section',
                text: {
                    type: 'mrkdwn',
                    text: `${colorEmoji} *<${pr.html_url}|${truncateTitle(pr.title)}>* - 👤 *${author} (${pr.user.login})* - ⏱ *${daysOpen}* days`,
                },
            });
        }
    }

    blocks.push({
        type: 'context',
        elements: [{ type: 'mrkdwn', text: '🔎 Don\'t forget to review these PRs today!' }],
    });

    return blocks;
}

function truncateTitle(title: string, maxLength: number = 100) {
    return title.length > maxLength ? title.substring(0, maxLength) + '…' : title;
}

async function processTeam(team: Team, creds: { GITHUB_TOKEN: string; GITHUB_ORG: string; SLACK_TOKEN: string }) {
    let hasPRs = false;
    const prsByRepo: Record<string, any[]> = {};

    for (const repo of team.repositories) {
        const prs = await getOpenPRs(repo, creds.GITHUB_ORG, creds.GITHUB_TOKEN);
        const teamPRs = prs
            .filter((pr: any) => !pr.draft)
            .filter((pr: any) => team.members.includes(pr.user.login));

        if (teamPRs.length > 0) {
            hasPRs = true;
            prsByRepo[repo] = teamPRs;
        }
    }

    if (hasPRs) {
        const blocks = await buildSlackBlocks(team, prsByRepo, creds.GITHUB_TOKEN);
        await sendSlackMessage(team.slack_channel, blocks, creds.SLACK_TOKEN);
    } else {
        await axios.post('https://slack.com/api/chat.postMessage', {
            channel: team.slack_channel,
            text: `:tada: No open PRs for ${team.name}!`,
        }, {
            headers: {
                Authorization: `Bearer ${creds.SLACK_TOKEN}`,
                'Content-Type': 'application/json',
            },
        });
    }
}

export async function main() {
    try {
        // When testing locally, only use environment variables
        const isLocalTest = process.env.CONFIG_PATH?.includes('test');

        const GITHUB_TOKEN = isLocalTest ? process.env.GITHUB_TOKEN : (process.env.GITHUB_TOKEN || await getSecret('/pr-reminder/github_token'));
        const GITHUB_ORG = isLocalTest ? process.env.GITHUB_ORG : (process.env.GITHUB_ORG || await getSecret('/pr-reminder/github_org'));
        const SLACK_TOKEN = isLocalTest ? process.env.SLACK_TOKEN : (process.env.SLACK_TOKEN || await getSecret('/pr-reminder/slack_token'));

        if (!GITHUB_TOKEN || !SLACK_TOKEN || !GITHUB_ORG) {
            console.error('Missing required environment variables. Please check your .env file');
            process.exit(1);
        }

        const credentials = {
            GITHUB_TOKEN,
            GITHUB_ORG,
            SLACK_TOKEN
        };

        const configPath = process.env.CONFIG_PATH || 'config.yaml';
        const config = yaml.load(fs.readFileSync(configPath, 'utf8')) as Config;
        const teamName = process.env.TEAM_NAME;

        console.log('Starting PR reminder check...');

        // Filter teams based on schedule or manual trigger
        const teamsToProcess = config.teams.filter(team => {
            // If we're in test mode, always process the team
            if (isLocalTest) {
                console.log(`Processing test team: ${team.name}`);
                return true;
            }

            // If manually triggered with a specific team
            if (teamName && teamName !== 'All') {
                console.log(`Manual trigger for team: ${team.name}`);
                return team.name === teamName;
            }

            // If manually triggered with 'All'
            if (teamName === 'All') {
                console.log(`Processing all teams: ${team.name}`);
                return true;
            }

            // If triggered by schedule, check the team's schedule
            const shouldRun = shouldRunForSchedule(team.schedule);
            if (shouldRun) {
                console.log(`Schedule matched for team: ${team.name} (${team.schedule})`);
            }
            return shouldRun;
        });

        if (teamsToProcess.length === 0) {
            console.log('No teams to process at this time based on schedules');
            return;
        }

        for (const team of teamsToProcess) {
            console.log(`Processing team: ${team.name}`);
            await processTeam(team, credentials);
        }
    } catch (error) {
        console.error('Error:', error);
        process.exit(1);
    }
}

if (require.main === module) {
    (async () => {
        await main();
    })();
}
