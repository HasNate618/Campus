# Deploy with an AI agent

Campus ships a `campus-deploy` skill (see `../skills/campus-deploy/SKILL.md`) that guides an agent through setup. The one hard requirement is an OpenAI-compatible `/v1` endpoint with tool calling, and the skill also covers every optional service and a verifiable preflight. Point your agent at it:

> Use the campus-deploy skill in this repo to set up Campus. My goal: <your goal>.

Replace `<your goal>` with what you actually want, for example "I have an OpenAI API key and want chat working against my Brightspace courses." The skill tells the agent the real prerequisites so it doesn't guess.

