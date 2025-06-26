import axios from 'axios';
import * as yaml from 'js-yaml';
import * as fs from 'fs';
import dayjs from 'dayjs';
import dotenv from 'dotenv';

dotenv.config();

interface Config {
    teams: Team[];
}

interface Team {
    name: string;
    slack_channel: string;
    repositories: string[];
    members: string[];
}

const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const GITHUB_ORG = process.env.GITHUB_ORG;
const SLACK_TOKEN = process.env.SLACK_TOKEN;

if (!GITHUB_TOKEN || !SLACK_TOKEN || !GITHUB_ORG) {
    console.error('Missing environment variables.');
    process.exit(1);
}

const config: Config = yaml.load(fs.readFileSync('./config.yaml', 'utf8')) as Config;

async function getOpenPRs(repo: string) {
    const url = `https://api.github.com/repos/${GITHUB_ORG}/${repo}/pulls?state=open&per_page=100`;
    const response = await axios.get(url, {
        headers: {
            Authorization: `Bearer ${GITHUB_TOKEN}`,
            Accept: 'application/vnd.github+json',
        },
    });
    return response.data;
}

async function sendSlackMessage(channel: string, blocks: any) {
    await axios.post('https://slack.com/api/chat.postMessage', {
        channel,
        blocks
    }, {
        headers: {
            Authorization: `Bearer ${SLACK_TOKEN}`,
            'Content-Type': 'application/json',
        },
    });
}

function buildSlackBlocks(team: Team, prsByRepo: Record<string, any[]>) {
    const blocks: any[] = [
        {
            type: 'header',
            text: {
                type: 'plain_text',
                text: `🔔 Open PRs for ${team.name}`,
                emoji: true
            },
        },
        {
            type: 'divider'
        }
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

            blocks.push({
                type: 'section',
                text: {
                    type: 'mrkdwn',
                    text: `${colorEmoji} *<${pr.html_url}|${pr.title}>* - 👤 *${pr.user.login}* - ⏱ *${daysOpen}* days`,
                },
            });
        }
    }

    return blocks;
}

async function processTeam(team: Team) {
    let hasPRs = false;
    const prsByRepo: Record<string, any[]> = {};

    for (const repo of team.repositories) {
        const prs = await getOpenPRs(repo);
        const teamPRs = prs.filter((pr: any) => team.members.includes(pr.user.login));

        if (teamPRs.length > 0) {
            hasPRs = true;
            prsByRepo[repo] = teamPRs;
        }
    }

    if (hasPRs) {
        const blocks = buildSlackBlocks(team, prsByRepo);
        await sendSlackMessage(team.slack_channel, blocks);
    } else {
        await axios.post('https://slack.com/api/chat.postMessage', {
            channel: team.slack_channel,
            text: `:tada: No open PRs for ${team.name}!`,
        }, {
            headers: {
                Authorization: `Bearer ${SLACK_TOKEN}`,
                'Content-Type': 'application/json',
            },
        });
    }
}

function truncateTitle(title: string, maxLength: number = 100) {
    return title.length > maxLength ? title.substring(0, maxLength) + '…' : title;
}

(async () => {
    for (const team of config.teams) {
        try {
            await processTeam(team);
        } catch (err) {
            console.error(`Error processing team ${team.name}:`, err);
        }
    }
})();
