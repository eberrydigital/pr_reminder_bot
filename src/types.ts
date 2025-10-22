export interface Config {
    teams: Team[];
}

export interface Team {
    name: string;
    slack_channel: string;
    repositories: string[];
    members: string[];
    schedule: string;
}
