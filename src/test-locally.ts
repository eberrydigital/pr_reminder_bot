import dotenv from 'dotenv';
import * as fs from 'fs';
import * as yaml from 'js-yaml';
import * as path from 'path';
import { Config } from './types';

const envPath = path.resolve(__dirname, '../.env');
const envContent = fs.readFileSync(envPath, 'utf8');

const result = dotenv.config({ path: envPath });
if (result.error) {
    throw result.error;
}

// Validate required environment variables
function getRequiredEnvVar(name: string): string {
    const value = process.env[name];
    if (!value) {
        throw new Error(`Missing required environment variable: ${name}`);
    }
    return value;
}

// Create a temporary test configuration
const testConfig: Config = {
    teams: [
        {
            name: getRequiredEnvVar('TEST_TEAM_NAME'),
            slack_channel: getRequiredEnvVar('TEST_SLACK_CHANNEL'),
            repositories: getRequiredEnvVar('TEST_REPOSITORIES').split(','),
            members: getRequiredEnvVar('TEST_TEAM_MEMBERS').split(','),
            schedule: getRequiredEnvVar('TEST_SCHEDULE')
        }
    ]
};

const TEST_CONFIG_PATH = 'config.test.yaml';
fs.writeFileSync(TEST_CONFIG_PATH, yaml.dump(testConfig));

process.env.TEAM_NAME = 'Test Team';
process.env.CONFIG_PATH = TEST_CONFIG_PATH;

import('./index').then(async ({ main }) => {
    try {
        await main();
        console.log('Test completed successfully!');
    } catch (error) {
        console.error('Test failed:', error);
    } finally {
        fs.unlinkSync(TEST_CONFIG_PATH);
    }
});
