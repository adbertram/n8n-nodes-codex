import {
	IDataObject,
	IExecuteFunctions,
	INodeExecutionData,
	INodeType,
	INodeTypeDescription,
	NodeOperationError,
} from 'n8n-workflow';
import { spawn } from 'child_process';

type OutputFormat = 'text' | 'structured' | 'json';
type ResumeMode = 'new' | 'last' | 'sessionId';
type SandboxMode = 'default' | 'read-only' | 'workspace-write' | 'danger-full-access';
type ApprovalPolicy = 'default' | 'untrusted' | 'on-request' | 'never';

interface JsonEvent {
	type?: string;
	[key: string]: unknown;
}

interface EnvVarItem {
	name: string;
	value: string;
}

interface MessageSummary {
	role: string;
	content: unknown;
	text: string | undefined;
}

interface ToolCallSummary {
	id: string | undefined;
	name: string | undefined;
	status: string | undefined;
	input: unknown;
	output: unknown;
}

interface CodexSummary {
	finalResult: string | undefined;
	sessionId: string | undefined;
	threadId: string | undefined;
	model: string | undefined;
	status: string | undefined;
	isError: boolean;
	eventsCount: number;
	lastEventType: string | undefined;
	usage: unknown;
	messages: MessageSummary[];
	toolCalls: ToolCallSummary[];
	rawFinalEvent: unknown;
}

export class Codex implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Codex',
		name: 'codex',
		icon: 'file:codex.svg',
		group: ['transform'],
		version: 1,
		subtitle: '={{$parameter["operation"]}}',
		description: 'Run prompts via the Codex native CLI (codex exec ...)',
		defaults: {
			name: 'Codex',
		},
		inputs: ['main'],
		outputs: ['main'],
		credentials: [],
		properties: [
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				options: [
					{
						name: 'Run Prompt',
						value: 'runPrompt',
						description: 'Send a prompt to Codex and capture the response',
						action: 'Run a prompt',
					},
				],
				default: 'runPrompt',
			},
			{
				displayName: 'Prompt',
				name: 'prompt',
				type: 'string',
				typeOptions: {
					rows: 6,
				},
				required: true,
				default: '',
				description: 'Prompt sent to Codex as the instruction argument',
			},
			{
				displayName: 'Output Format',
				name: 'outputFormat',
				type: 'options',
				options: [
					{
						name: 'Text (final CLI Output)',
						value: 'text',
						description: 'Return the Codex CLI stdout as text',
					},
					{
						name: 'Structured (parsed events)',
						value: 'structured',
						description: 'Run with --json and return a parsed summary',
					},
					{
						name: 'Raw JSON Events',
						value: 'json',
						description: 'Run with --json and return every JSONL event as an array',
					},
				],
				default: 'structured',
			},
			{
				displayName: 'Model',
				name: 'model',
				type: 'string',
				default: '',
				placeholder: 'gpt-5.2, gpt-5.4, o3, ...',
				description: 'Leave empty to use the Codex CLI default',
			},
			{
				displayName: 'Working Directory',
				name: 'workingDirectory',
				type: 'string',
				default: '',
				placeholder: '/data/projects/my-repo',
				description: 'Directory passed to Codex with --cd and used as the process cwd',
			},
			{
				displayName: 'Resume Mode',
				name: 'resumeMode',
				type: 'options',
				options: [
					{ name: 'New Session', value: 'new' },
					{ name: 'Resume Most Recent (--last)', value: 'last' },
					{ name: 'Resume by Session ID', value: 'sessionId' },
				],
				default: 'new',
			},
			{
				displayName: 'Session ID',
				name: 'sessionId',
				type: 'string',
				default: '',
				placeholder: '550e8400-e29b-41d4-a716-446655440000',
				displayOptions: {
					show: {
						resumeMode: ['sessionId'],
					},
				},
			},
			{
				displayName: 'Sandbox Mode',
				name: 'sandboxMode',
				type: 'options',
				options: [
					{ name: 'Default', value: 'default' },
					{ name: 'Read Only', value: 'read-only' },
					{ name: 'Workspace Write', value: 'workspace-write' },
					{ name: 'Danger Full Access', value: 'danger-full-access' },
				],
				default: 'default',
				description: 'Codex sandbox policy for model-generated shell commands',
			},
			{
				displayName: 'Approval Policy',
				name: 'approvalPolicy',
				type: 'options',
				options: [
					{ name: 'Default', value: 'default' },
					{ name: 'Untrusted', value: 'untrusted' },
					{ name: 'On Request', value: 'on-request' },
					{ name: 'Never', value: 'never' },
				],
				default: 'default',
				description: 'When Codex should ask for command approval',
			},
			{
				displayName: 'Bypass Approvals and Sandbox',
				name: 'bypassApprovalsAndSandbox',
				type: 'boolean',
				default: false,
				description:
					'Whether to pass --dangerously-bypass-approvals-and-sandbox. Use only in an externally sandboxed environment.',
			},
			{
				displayName: 'Additional Options',
				name: 'additionalOptions',
				type: 'collection',
				placeholder: 'Add Option',
				default: {},
				options: [
					{
						displayName: 'Add Directories',
						name: 'addDirs',
						type: 'string',
						default: '',
						placeholder: '/data/lib,/data/shared',
						description: 'Newline- or comma-separated additional writable dirs (--add-dir)',
					},
					{
						displayName: 'Additional CLI Args (Raw)',
						name: 'additionalArgs',
						type: 'string',
						default: '',
						description: 'Extra args appended before the prompt',
					},
					{
						displayName: 'Codex Binary Path',
						name: 'codexBinaryPath',
						type: 'string',
						default: 'codex',
						description: 'Path to the codex executable',
					},
					{
						displayName: 'Config Overrides',
						name: 'configOverrides',
						type: 'string',
						default: '',
						placeholder: 'model_reasoning_effort="high"',
						description: 'One -c key=value override per line',
					},
					{
						displayName: 'Disable Features',
						name: 'disableFeatures',
						type: 'string',
						default: '',
						description: 'Comma- or newline-separated feature names for --disable',
					},
					{
						displayName: 'Enable Features',
						name: 'enableFeatures',
						type: 'string',
						default: '',
						description: 'Comma- or newline-separated feature names for --enable',
					},
					{
						displayName: 'Environment Variables',
						name: 'envVars',
						type: 'fixedCollection',
						placeholder: 'Add Variable',
						typeOptions: {
							multipleValues: true,
						},
						default: {},
						options: [
							{
								name: 'env',
								displayName: 'Variable',
								values: [
									{
										displayName: 'Name',
										name: 'name',
										type: 'string',
										default: '',
									},
									{
										displayName: 'Value',
										name: 'value',
										type: 'string',
										default: '',
									},
								],
							},
						],
					},
					{
						displayName: 'Ephemeral',
						name: 'ephemeral',
						type: 'boolean',
						default: false,
						description: 'Whether to run without persisting session files',
					},
					{
						displayName: 'Ignore Project Rules',
						name: 'ignoreRules',
						type: 'boolean',
						default: false,
						description: 'Whether to add --ignore-rules',
					},
					{
						displayName: 'Ignore User Config',
						name: 'ignoreUserConfig',
						type: 'boolean',
						default: false,
						description: 'Whether to add --ignore-user-config',
					},
					{
						displayName: 'Images',
						name: 'images',
						type: 'string',
						default: '',
						placeholder: '/data/image.png,/data/mockup.jpg',
						description: 'Newline- or comma-separated image paths passed with --image',
					},
					{
						displayName: 'Local Provider',
						name: 'localProvider',
						type: 'options',
						options: [
							{ name: 'Default', value: '' },
							{ name: 'LM Studio', value: 'lmstudio' },
							{ name: 'Ollama', value: 'ollama' },
						],
						default: '',
					},
					{
						displayName: 'Output Last Message File',
						name: 'outputLastMessageFile',
						type: 'string',
						default: '',
						description: 'Path passed to --output-last-message',
					},
					{
						displayName: 'Output Schema File',
						name: 'outputSchemaFile',
						type: 'string',
						default: '',
						description: 'JSON Schema file passed to --output-schema for new sessions',
					},
					{
						displayName: 'Profile',
						name: 'profile',
						type: 'string',
						default: '',
						description: 'Configuration profile from config.toml',
					},
					{
						displayName: 'Skip Git Repo Check',
						name: 'skipGitRepoCheck',
						type: 'boolean',
						default: false,
						description: 'Whether to allow running Codex outside a Git repository',
					},
					{
						displayName: 'Timeout (Seconds)',
						name: 'timeout',
						type: 'number',
						default: 600,
						description: 'Kill the codex process after this many seconds',
					},
					{
						displayName: 'Use OSS Provider',
						name: 'oss',
						type: 'boolean',
						default: false,
						description: 'Whether to add --oss',
					},
					{
						displayName: 'Web Search',
						name: 'webSearch',
						type: 'boolean',
						default: false,
						description: 'Whether to enable live web search with --search',
					},
				],
			},
		],
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const items = this.getInputData();
		const returnData: INodeExecutionData[] = [];

		for (let i = 0; i < items.length; i++) {
			try {
				const result = await runCodex.call(this, i);
				returnData.push({
					json: result as unknown as IDataObject,
					pairedItem: { item: i },
				});
			} catch (error) {
				if (this.continueOnFail()) {
					returnData.push({
						json: { error: (error as Error).message },
						pairedItem: { item: i },
					});
					continue;
				}
				throw new NodeOperationError(this.getNode(), error as Error, {
					itemIndex: i,
				});
			}
		}

		return [returnData];
	}
}

async function runCodex(
	this: IExecuteFunctions,
	itemIndex: number,
): Promise<IDataObject> {
	const prompt = this.getNodeParameter('prompt', itemIndex) as string;
	const outputFormat = this.getNodeParameter('outputFormat', itemIndex) as OutputFormat;
	const model = this.getNodeParameter('model', itemIndex, '') as string;
	const workingDirectory = this.getNodeParameter(
		'workingDirectory',
		itemIndex,
		'',
	) as string;
	const resumeMode = this.getNodeParameter('resumeMode', itemIndex) as ResumeMode;
	const sessionId = this.getNodeParameter('sessionId', itemIndex, '') as string;
	const sandboxMode = this.getNodeParameter(
		'sandboxMode',
		itemIndex,
	) as SandboxMode;
	const approvalPolicy = this.getNodeParameter(
		'approvalPolicy',
		itemIndex,
	) as ApprovalPolicy;
	const bypassApprovalsAndSandbox = this.getNodeParameter(
		'bypassApprovalsAndSandbox',
		itemIndex,
	) as boolean;
	const additionalOptions = this.getNodeParameter(
		'additionalOptions',
		itemIndex,
		{},
	) as IDataObject;

	if (!prompt || !prompt.trim()) {
		throw new Error('Prompt is required');
	}

	if (resumeMode === 'sessionId' && !sessionId.trim()) {
		throw new Error('Session ID is required when Resume Mode is "sessionId"');
	}

	const args = buildCodexArgs({
		prompt,
		outputFormat,
		model,
		workingDirectory,
		resumeMode,
		sessionId,
		sandboxMode,
		approvalPolicy,
		bypassApprovalsAndSandbox,
		additionalOptions,
	});

	const codexBinaryPath =
		((additionalOptions.codexBinaryPath as string) || '').trim() || 'codex';
	const timeoutMs = (((additionalOptions.timeout as number) || 600) as number) * 1000;

	const env: NodeJS.ProcessEnv = { ...process.env };
	const envVarsCollection = additionalOptions.envVars as IDataObject | undefined;
	if (envVarsCollection?.env && Array.isArray(envVarsCollection.env)) {
		for (const v of envVarsCollection.env as EnvVarItem[]) {
			if (v && v.name) env[v.name] = v.value ?? '';
		}
	}

	const cwd = workingDirectory.trim() || undefined;
	const { stdout, stderr } = await spawnCodex(
		codexBinaryPath,
		args,
		cwd,
		env,
		timeoutMs,
	);
	const trimmedStderr = stderr.trim();

	if (outputFormat === 'text') {
		return {
			text: stdout.replace(/\s+$/, ''),
			...(trimmedStderr ? { stderr: trimmedStderr } : {}),
		};
	}

	const events = parseJsonLines(stdout);

	if (outputFormat === 'json') {
		return {
			events: events as unknown as IDataObject[],
			...(trimmedStderr ? { stderr: trimmedStderr } : {}),
		};
	}

	const summary = summarizeEvents(events);
	return {
		...(summary as unknown as IDataObject),
		...(trimmedStderr ? { stderr: trimmedStderr } : {}),
	};
}

function buildCodexArgs(options: {
	prompt: string;
	outputFormat: OutputFormat;
	model: string;
	workingDirectory: string;
	resumeMode: ResumeMode;
	sessionId: string;
	sandboxMode: SandboxMode;
	approvalPolicy: ApprovalPolicy;
	bypassApprovalsAndSandbox: boolean;
	additionalOptions: IDataObject;
}): string[] {
	const {
		prompt,
		outputFormat,
		model,
		workingDirectory,
		resumeMode,
		sessionId,
		sandboxMode,
		approvalPolicy,
		bypassApprovalsAndSandbox,
		additionalOptions,
	} = options;
	const globalArgs: string[] = [];
	const execArgs: string[] = [];

	appendRepeated(globalArgs, '-c', splitLines(additionalOptions.configOverrides as string));
	appendRepeated(globalArgs, '--enable', splitList(additionalOptions.enableFeatures as string));
	appendRepeated(globalArgs, '--disable', splitList(additionalOptions.disableFeatures as string));

	const profile = ((additionalOptions.profile as string) || '').trim();
	if (profile) globalArgs.push('--profile', profile);

	if (model.trim()) globalArgs.push('--model', model.trim());
	if (additionalOptions.oss) globalArgs.push('--oss');

	const localProvider = ((additionalOptions.localProvider as string) || '').trim();
	if (localProvider) globalArgs.push('--local-provider', localProvider);

	if (sandboxMode !== 'default') globalArgs.push('--sandbox', sandboxMode);
	if (approvalPolicy !== 'default') globalArgs.push('--ask-for-approval', approvalPolicy);
	if (bypassApprovalsAndSandbox) {
		globalArgs.push('--dangerously-bypass-approvals-and-sandbox');
	}

	if (workingDirectory.trim()) globalArgs.push('--cd', workingDirectory.trim());

	appendRepeated(globalArgs, '--add-dir', splitList(additionalOptions.addDirs as string));
	appendRepeated(globalArgs, '--image', splitList(additionalOptions.images as string));

	if (additionalOptions.webSearch) globalArgs.push('--search');

	if (outputFormat !== 'text') execArgs.push('--json');
	if (resumeMode === 'new') execArgs.push('--color', 'never');

	if (additionalOptions.skipGitRepoCheck) execArgs.push('--skip-git-repo-check');
	if (additionalOptions.ephemeral) execArgs.push('--ephemeral');
	if (additionalOptions.ignoreUserConfig) execArgs.push('--ignore-user-config');
	if (additionalOptions.ignoreRules) execArgs.push('--ignore-rules');

	const outputLastMessageFile = (
		(additionalOptions.outputLastMessageFile as string) || ''
	).trim();
	if (outputLastMessageFile) execArgs.push('--output-last-message', outputLastMessageFile);

	const outputSchemaFile = ((additionalOptions.outputSchemaFile as string) || '').trim();
	if (resumeMode === 'new' && outputSchemaFile) {
		execArgs.push('--output-schema', outputSchemaFile);
	}

	const additionalArgs = ((additionalOptions.additionalArgs as string) || '').trim();
	if (additionalArgs) execArgs.push(...parseRawArgs(additionalArgs));

	if (resumeMode === 'last') {
		return [...globalArgs, 'exec', 'resume', ...execArgs, '--last', prompt];
	}

	if (resumeMode === 'sessionId') {
		return [...globalArgs, 'exec', 'resume', ...execArgs, sessionId.trim(), prompt];
	}

	return [...globalArgs, 'exec', ...execArgs, prompt];
}

function spawnCodex(
	binary: string,
	args: string[],
	cwd: string | undefined,
	env: NodeJS.ProcessEnv,
	timeoutMs: number,
): Promise<{ stdout: string; stderr: string }> {
	return new Promise((resolve, reject) => {
		const child = spawn(binary, args, {
			cwd,
			env,
			stdio: ['ignore', 'pipe', 'pipe'],
		});

		let stdout = '';
		let stderr = '';
		let timedOut = false;

		const timer = setTimeout(() => {
			timedOut = true;
			child.kill('SIGTERM');
			setTimeout(() => {
				if (!child.killed) child.kill('SIGKILL');
			}, 5000);
		}, timeoutMs);

		child.stdout?.on('data', (chunk: Buffer) => {
			stdout += chunk.toString('utf8');
		});
		child.stderr?.on('data', (chunk: Buffer) => {
			stderr += chunk.toString('utf8');
		});

		child.on('error', (err) => {
			clearTimeout(timer);
			reject(new Error(`Failed to spawn ${binary}: ${err.message}`));
		});

		child.on('close', (code) => {
			clearTimeout(timer);
			if (timedOut) {
				return reject(
					new Error(
						`codex timed out after ${timeoutMs / 1000}s\nstderr: ${stderr}`,
					),
				);
			}
			if (code !== 0) {
				return reject(
					new Error(
						`codex exited with code ${code}\nstderr: ${stderr}\nstdout (head): ${stdout.slice(0, 4000)}`,
					),
				);
			}
			resolve({ stdout, stderr });
		});
	});
}

function parseJsonLines(stdout: string): JsonEvent[] {
	const events: JsonEvent[] = [];
	for (const line of stdout.split(/\r?\n/)) {
		const trimmed = line.trim();
		if (!trimmed) continue;
		try {
			events.push(JSON.parse(trimmed) as JsonEvent);
		} catch {
			events.push({ type: 'non_json_output', text: trimmed });
		}
	}
	return events;
}

function summarizeEvents(events: JsonEvent[]): CodexSummary {
	const summary: CodexSummary = {
		finalResult: undefined,
		sessionId: undefined,
		threadId: undefined,
		model: undefined,
		status: undefined,
		isError: false,
		eventsCount: events.length,
		lastEventType: undefined,
		usage: undefined,
		messages: [],
		toolCalls: [],
		rawFinalEvent: undefined,
	};

	for (const event of events) {
		const type = stringValue(event.type);
		if (type) summary.lastEventType = type;

		const sessionId =
			stringValue(event.session_id) ??
			stringValue(event.sessionId) ??
			stringValue(event.conversation_id) ??
			stringValue(event.conversationId);
		if (sessionId && !summary.sessionId) summary.sessionId = sessionId;

		const threadId = stringValue(event.thread_id) ?? stringValue(event.threadId);
		if (threadId && !summary.threadId) summary.threadId = threadId;

		const model = stringValue(event.model) ?? stringValue(getNested(event, ['message', 'model']));
		if (model && !summary.model) summary.model = model;

		const status =
			stringValue(event.status) ??
			stringValue(event.outcome) ??
			stringValue(event.terminal_reason);
		if (status) summary.status = status;

		if (event.usage !== undefined) summary.usage = event.usage;
		if (event.error !== undefined || event.is_error === true || type?.includes('error')) {
			summary.isError = true;
		}

		const message = extractMessage(event);
		if (message) {
			summary.messages.push(message);
			if (message.role === 'assistant' && message.text) {
				summary.finalResult = message.text;
				summary.rawFinalEvent = event;
			}
		}

		const toolCall = extractToolCall(event);
		if (toolCall) summary.toolCalls.push(toolCall);

		const explicitFinal = extractExplicitFinalText(event);
		if (explicitFinal) {
			summary.finalResult = explicitFinal;
			summary.rawFinalEvent = event;
		}
	}

	return summary;
}

function extractMessage(event: JsonEvent): MessageSummary | undefined {
	const message = asRecord(event.message);
	if (message) {
		const role = stringValue(message.role) ?? inferRole(event) ?? 'assistant';
		const content = message.content ?? message.text ?? message.message;
		return {
			role,
			content,
			text: extractText(content),
		};
	}

	const item = asRecord(event.item);
	if (item && (item.type === 'message' || item.role !== undefined)) {
		const role = stringValue(item.role) ?? inferRole(event) ?? 'assistant';
		const content = item.content ?? item.text ?? item.message;
		return {
			role,
			content,
			text: extractText(content),
		};
	}

	const type = stringValue(event.type) ?? '';
	if (type.includes('message')) {
		const text = stringValue(event.text) ?? stringValue(event.message);
		if (text) {
			return {
				role: inferRole(event) ?? 'assistant',
				content: text,
				text,
			};
		}
	}

	return undefined;
}

function extractToolCall(event: JsonEvent): ToolCallSummary | undefined {
	const item = asRecord(event.item);
	const source = item ?? event;
	const type = stringValue(source.type) ?? stringValue(event.type) ?? '';
	if (!type.includes('tool') && source.name === undefined && source.tool_name === undefined) {
		return undefined;
	}

	return {
		id: stringValue(source.id) ?? stringValue(source.call_id),
		name:
			stringValue(source.name) ??
			stringValue(source.tool_name) ??
			stringValue(getNested(source, ['function', 'name'])),
		status: stringValue(source.status),
		input: source.input ?? source.arguments ?? getNested(source, ['function', 'arguments']),
		output: source.output ?? source.result,
	};
}

function extractExplicitFinalText(event: JsonEvent): string | undefined {
	const type = stringValue(event.type) ?? '';
	if (
		type.includes('final') ||
		type === 'agent_message' ||
		type === 'response.completed' ||
		type === 'turn.completed'
	) {
		return (
			stringValue(event.final_response) ??
			stringValue(event.finalResponse) ??
			stringValue(event.response) ??
			stringValue(event.output) ??
			stringValue(event.text) ??
			extractText(event.message)
		);
	}
	return undefined;
}

function extractText(value: unknown): string | undefined {
	if (typeof value === 'string') return value;
	if (Array.isArray(value)) {
		const parts = value
			.map((part) => extractText(part))
			.filter((part): part is string => Boolean(part));
		return parts.length > 0 ? parts.join('\n') : undefined;
	}
	const record = asRecord(value);
	if (!record) return undefined;

	return (
		stringValue(record.text) ??
		stringValue(record.output_text) ??
		stringValue(record.message) ??
		extractText(record.content)
	);
}

function inferRole(event: JsonEvent): string | undefined {
	const type = stringValue(event.type) ?? '';
	if (type.includes('assistant') || type.includes('agent')) return 'assistant';
	if (type.includes('user')) return 'user';
	if (type.includes('system')) return 'system';
	return undefined;
}

function splitList(value: string | undefined): string[] {
	return ((value || '').match(/(?:[^\s,]+|"[^"]*"|'[^']*')+/g) || [])
		.map((token) => token.replace(/^["']|["']$/g, '').trim())
		.filter(Boolean);
}

function splitLines(value: string | undefined): string[] {
	return (value || '')
		.split(/\r?\n/)
		.map((line) => line.trim())
		.filter(Boolean);
}

function parseRawArgs(value: string): string[] {
	return (value.match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g) || []).map((token) =>
		token.replace(/^["']|["']$/g, ''),
	);
}

function appendRepeated(args: string[], flag: string, values: string[]): void {
	for (const value of values) args.push(flag, value);
}

function getNested(source: unknown, path: string[]): unknown {
	let current = source;
	for (const key of path) {
		const record = asRecord(current);
		if (!record) return undefined;
		current = record[key];
	}
	return current;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
	if (value && typeof value === 'object' && !Array.isArray(value)) {
		return value as Record<string, unknown>;
	}
	return undefined;
}

function stringValue(value: unknown): string | undefined {
	return typeof value === 'string' && value.length > 0 ? value : undefined;
}
