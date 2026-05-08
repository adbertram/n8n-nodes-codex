# n8n-nodes-codex

Unofficial n8n community node for running prompts with the Codex CLI.

This package wraps the native `codex exec` command. It does not use the OpenAI SDK and it does not provide a hosted Codex runtime. The `codex` executable must be installed and configured in the same environment where n8n runs.

This project is not affiliated with, endorsed by, or sponsored by OpenAI. OpenAI and Codex are trademarks of OpenAI.

## Features

- Run a prompt with `codex exec`.
- Return plain text, raw JSONL events, or a parsed structured summary.
- Select model, working directory, resume mode, sandbox mode, and approval policy.
- Pass advanced Codex CLI options such as config overrides, images, extra writable directories, and web search.

## Requirements

- n8n with community nodes enabled.
- Node.js 22.0 or newer.
- Codex CLI installed in the same host or container as n8n.
- Codex CLI already authenticated and configured for the user that runs n8n.

You should be able to run this successfully from the n8n runtime environment:

```sh
codex exec --help
```

## Installation

Install the package from n8n's Community Nodes settings:

```text
n8n-nodes-codex
```

For manual self-hosted installs, install it into the n8n environment using npm:

```sh
npm install n8n-nodes-codex
```

Restart n8n after installation if your deployment does not reload community nodes automatically.

## Docker Notes

When n8n runs in Docker, this node runs inside the n8n container too. That means the container needs:

- the `codex` binary available on `PATH`, or a custom binary path set in the node options;
- Codex authentication and configuration mounted or created inside the container;
- any working directory or repository mounted at a path visible inside the container;
- permissions that allow the n8n process to read and write the intended workspace.

For example, if your workflow sets `Working Directory` to `/data/project`, that path must exist inside the n8n container, not only on the host.

## Usage

Add the `Codex` node to a workflow and choose `Run Prompt`.

Common settings:

- `Prompt`: instruction passed to Codex.
- `Output Format`: `Structured` for a parsed summary, `Raw JSON Events` for full JSONL output, or `Text` for plain stdout.
- `Working Directory`: passed to Codex with `--cd` and also used as the process working directory.
- `Resume Mode`: start a new session, resume the most recent session, or resume by session ID.
- `Sandbox Mode` and `Approval Policy`: forwarded to Codex CLI.

## Security Notes

This node executes `codex exec` on the n8n server or inside the n8n container. Treat it like any workflow step that can run commands or modify files in its execution environment.

- Use the least permissive Codex sandbox and approval settings that work for your workflow.
- Avoid `Bypass Approvals and Sandbox` unless n8n already runs in a separate locked-down environment.
- Avoid putting secrets such as API keys in the node's `Environment Variables` parameter. Prefer host/container environment configuration, mounted Codex configuration, or your platform's secret management.
- Make sure workflow users understand which filesystem paths the n8n process can access.

## Development

Install dependencies:

```sh
npm install
```

Run checks:

```sh
npm run lint
npm run build
npm run check
```

Run the smoke test only in an environment where `codex` is installed and authenticated:

```sh
npm run smoke
```

## Publishing

This repository includes GitHub Actions workflows for CI and npm publishing.

- `CI` runs on pull requests and pushes to `main`.
- `Publish to npm` runs when a tag like `v0.1.0` is pushed.
- The publish workflow requires an npm automation token stored as the GitHub repository secret `NPM_TOKEN`.
- The tag name must match the package version in `package.json` with a leading `v`.

Release example:

```sh
git tag v0.1.0
git push origin v0.1.0
```

## License

MIT
