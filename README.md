# PR Reminder Bot

A slack bot that reminds teams every day at 08:00 of their open GitHub pull requests.

---

## Features
- Supports multiple teams
- Configurable via `config.yaml`
- Filters PRs based on team members
- Posts slack messages with open PRs from the repos defined in the yaml file
- Runs on GitHub Actions scheduler

---

## How to use it

### 1️⃣ Create a PR modifying `config.yaml` just adding a new block for your team

```yaml
teams:
  - name: Team Booking
    slack_channel: "#team-booking-notifications" <-- This is your slack channel id
    repositories:
      - e2e-tests <-- This is the repo, no need to pass the full url
      - strawberry-web
    members:
      - jane <-- This is your github username
      - lars
  - name: Team Member
    slack_channel: "#team-member-notifications"
    repositories:
      - api_member
    members:
      - pepe
      - maria
```

### 2️⃣ Environment Variables

You can run this locally with an `.env` file for testing:

```env
GITHUB_TOKEN=your-github-token
GITHUB_ORG=your-github-org
SLACK_TOKEN=your-slack-bot-token
```


## Installation (in case you want to collaborate)

```bash
git clone <your-repo>
cd pr-reminder-bot
npm install
npm start
```

---

## GitHub Actions
- This will run as a scheduled job every day at 08:00. Alternatively you can trigger it manually from github actions with PR Reminder Bot `Run workflow` button.
