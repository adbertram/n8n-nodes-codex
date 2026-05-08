# @oden-kun/n8n-nodes-codex

Run the local OpenAI Codex CLI from n8n workflows.

This is an unofficial n8n community node that wraps `codex exec`. It does not use the OpenAI SDK and it does not provide a hosted Codex runtime. The `codex` executable must be installed, authenticated, and available in the same environment where n8n runs.

This project is not affiliated with, endorsed by, or sponsored by OpenAI. OpenAI and Codex are trademarks of OpenAI.

## Features

- Run prompts through `codex exec` from an n8n workflow.
- Return plain text, raw JSONL events, or a parsed structured summary.
- Configure model, working directory, session resume mode, sandbox mode, and approval policy.
- Pass Codex CLI options such as config overrides, images, additional writable directories, and web search.
- Capture stderr and process failures as n8n node errors.

## Requirements

- n8n with community nodes enabled.
- Node.js 22.0 or newer.
- Codex CLI installed where n8n runs.
- Codex CLI authenticated for the same OS user or container user that runs n8n.

From the n8n runtime environment, this command should work:

```sh
codex exec --help
```

## Installation

Install the package from n8n's Community Nodes settings:

```text
@oden-kun/n8n-nodes-codex
```

For manual self-hosted installs, install it into the n8n environment:

```sh
npm install @oden-kun/n8n-nodes-codex
```

Restart n8n if your deployment does not reload community nodes automatically.

## Quick Start

Add a `Codex` node to a workflow and choose `Run Prompt`.

Common settings:

- `Prompt`: the instruction passed to Codex.
- `Output Format`: choose `Structured`, `Text`, or `Raw JSON Events`.
- `Working Directory`: passed to Codex with `--cd` and also used as the process cwd.
- `Resume Mode`: start a new session, resume the most recent session, or resume by session ID.
- `Sandbox Mode`: forwarded to Codex CLI.
- `Approval Policy`: forwarded to Codex CLI.

For most workflows, start with `Structured` output. It gives downstream nodes stable fields without forcing them to parse Codex JSONL events directly.

## Output Formats

`Structured` returns a parsed object with fields such as:

- `finalResult`: the final assistant response text.
- `sessionId` and `threadId`: identifiers found in Codex events when available.
- `model`, `status`, `usage`, and `isError`: run metadata.
- `messages`: extracted message events.
- `toolCalls`: extracted tool or function call events.
- `rawFinalEvent`: the raw event used to set the final result.

`Text` returns the final CLI stdout as `text`.

`Raw JSON Events` returns every parsed JSONL event as `events`.

## Docker and Self-Hosted Notes

When n8n runs in Docker, this node runs inside the n8n container too. The container needs:

- the `codex` binary available on `PATH`, or a custom binary path set in the node options;
- Codex authentication and configuration mounted or created inside the container;
- any working directory or repository mounted at a path visible inside the container;
- filesystem permissions that allow the n8n process to read and write the intended workspace.

For example, if a workflow sets `Working Directory` to `/data/project`, that path must exist inside the n8n container, not only on the host.

## Security

This node executes `codex exec` on the n8n server or inside the n8n container. Treat it like any workflow step that can run commands or modify files in its execution environment.

- Use the least permissive Codex sandbox and approval settings that work for your workflow.
- Avoid `Bypass Approvals and Sandbox` unless n8n already runs in a separate locked-down environment.
- Avoid putting secrets such as API keys in the node's `Environment Variables` parameter. Prefer host or container environment configuration, mounted Codex configuration, or your platform's secret management.
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

## License

MIT
