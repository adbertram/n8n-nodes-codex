import { ICredentialType, INodeProperties } from 'n8n-workflow';

export class CodexApi implements ICredentialType {
	name = 'codexApi';

	displayName = 'Codex CLI';

	documentationUrl = 'https://developers.openai.com/codex/cli';

	properties: INodeProperties[] = [
		{
			displayName: 'Codex Binary Path',
			name: 'codexPath',
			type: 'string',
			default: 'codex',
			required: true,
			description: 'Command or absolute path for the Codex CLI binary',
		},
		{
			displayName: 'Run As User',
			name: 'runAsUser',
			type: 'string',
			default: '',
			description: 'Optional OS user to run Codex as through sudo -u',
		},
		{
			displayName: 'Authentication',
			name: 'authMethod',
			type: 'options',
			noDataExpression: true,
			options: [
				{
					name: 'ChatGPT Sign-In',
					value: 'chatgpt',
					description:
						'Use the existing browser sign-in stored in the Codex home directory (usage-based ChatGPT plan)',
				},
				{
					name: 'API Key',
					value: 'apiKey',
					description:
						'Sign in with an OpenAI API key before each run (codex login --with-api-key)',
				},
			],
			default: 'chatgpt',
		},
		{
			displayName: 'API Key',
			name: 'apiKey',
			type: 'string',
			typeOptions: { password: true },
			default: '',
			required: true,
			displayOptions: { show: { authMethod: ['apiKey'] } },
			description: 'OpenAI API key written to the Codex home directory before the run',
		},
		{
			displayName: 'Codex Home',
			name: 'codexHome',
			type: 'string',
			default: '',
			placeholder: '/Users/adam/.codex',
			description:
				'Directory passed as CODEX_HOME. Holds auth.json, config.toml, and sessions. Leave empty to use ~/.codex with ChatGPT sign-in, or a fresh temporary directory with API key sign-in.',
		},
	];
}
