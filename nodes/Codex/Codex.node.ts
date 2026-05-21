import {
	IDataObject,
	IExecuteFunctions,
	INodeExecutionData,
	INodeProperties,
	INodePropertyOptions,
	INodeType,
	INodeTypeDescription,
	NodeOperationError,
} from 'n8n-workflow';
import { spawn } from 'child_process';
import { promises as fs } from 'fs';
import { homedir, tmpdir } from 'os';
import { join } from 'path';

const RUN_PROMPT_OPERATION = [
	{
		name: 'Run Prompt',
		value: 'runPrompt',
		description: 'Send a prompt to Codex and capture the response',
		action: 'Run a prompt',
	},
] as const;

const OUTPUT_FORMAT_OPTIONS = [
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
] as const;

const MODEL_OPTIONS = [
	{ name: 'Default', value: '' },
	{ name: 'GPT-5.5', value: 'gpt-5.5' },
	{ name: 'GPT-5.4', value: 'gpt-5.4' },
	{ name: 'GPT-5.4 Mini', value: 'gpt-5.4-mini' },
	{ name: 'GPT-5.3 Codex', value: 'gpt-5.3-codex' },
	{ name: 'GPT-5.2 Codex', value: 'gpt-5.2-codex' },
	{ name: 'GPT-5.1 Codex', value: 'gpt-5.1-codex' },
	{ name: 'Custom', value: 'custom' },
] as const;

const RESUME_MODE_OPTIONS = [
	{ name: 'New Session', value: 'new' },
	{ name: 'Resume Most Recent (--last)', value: 'last' },
	{ name: 'Resume by Session ID', value: 'sessionId' },
] as const;

const SANDBOX_MODE_OPTIONS = [
	{ name: 'Default', value: 'default' },
	{ name: 'Read Only', value: 'read-only' },
	{ name: 'Workspace Write', value: 'workspace-write' },
	{ name: 'Danger Full Access', value: 'danger-full-access' },
] as const;

const APPROVAL_POLICY_OPTIONS = [
	{ name: 'Default', value: 'default' },
	{ name: 'Untrusted', value: 'untrusted' },
	{ name: 'On Request', value: 'on-request' },
	{ name: 'Never', value: 'never' },
] as const;

const LOCAL_PROVIDER_OPTIONS = [
	{ name: 'Default', value: '' },
	{ name: 'LM Studio', value: 'lmstudio' },
	{ name: 'Ollama', value: 'ollama' },
] as const;

const REASONING_EFFORT_OPTIONS = [
	{ name: 'Default', value: 'default' },
	{ name: 'Minimal', value: 'minimal' },
	{ name: 'Low', value: 'low' },
	{ name: 'Medium', value: 'medium' },
	{ name: 'High', value: 'high' },
	{ name: 'XHigh', value: 'xhigh' },
] as const;

const REASONING_SUMMARY_OPTIONS = [
	{ name: 'Default', value: 'default' },
	{ name: 'Auto', value: 'auto' },
	{ name: 'Concise', value: 'concise' },
	{ name: 'Detailed', value: 'detailed' },
	{ name: 'None', value: 'none' },
] as const;

const VERBOSITY_OPTIONS = [
	{ name: 'Default', value: 'default' },
	{ name: 'Low', value: 'low' },
	{ name: 'Medium', value: 'medium' },
	{ name: 'High', value: 'high' },
] as const;

const WEB_SEARCH_OPTIONS = [
	{ name: 'Default', value: 'default' },
	{ name: 'Disabled', value: 'disabled' },
	{ name: 'Cached', value: 'cached' },
	{ name: 'Live', value: 'live' },
] as const;

type OutputFormat = (typeof OUTPUT_FORMAT_OPTIONS)[number]['value'];
type ModelSelection = (typeof MODEL_OPTIONS)[number]['value'];
type ResumeMode = (typeof RESUME_MODE_OPTIONS)[number]['value'];
type SandboxMode = (typeof SANDBOX_MODE_OPTIONS)[number]['value'];
type ApprovalPolicy = (typeof APPROVAL_POLICY_OPTIONS)[number]['value'];
type ReasoningEffort = (typeof REASONING_EFFORT_OPTIONS)[number]['value'];
type ReasoningSummary = (typeof REASONING_SUMMARY_OPTIONS)[number]['value'];
type ModelVerbosity = (typeof VERBOSITY_OPTIONS)[number]['value'];
type WebSearchMode = (typeof WEB_SEARCH_OPTIONS)[number]['value'];

interface JsonEvent {
	type?: string;
	[key: string]: unknown;
}

interface EnvVarItem {
	name: string;
	value: string;
}

interface PreparedSchemaFile {
	path: string | undefined;
	cleanup: () => Promise<void>;
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

interface FixedCollectionField {
	displayName: string;
	name: string;
	placeholder?: string;
}

function optionProperty(
	displayName: string,
	name: string,
	options: readonly INodePropertyOptions[],
	defaultValue: string,
	description?: string,
	extra: Partial<INodeProperties> = {},
): INodeProperties {
	return {
		displayName,
		name,
		type: 'options',
		options: [...options],
		default: defaultValue,
		...(description ? { description } : {}),
		...extra,
	};
}

function stringProperty(
	displayName: string,
	name: string,
	description?: string,
	extra: Partial<INodeProperties> = {},
): INodeProperties {
	return {
		displayName,
		name,
		type: 'string',
		default: '',
		...(description ? { description } : {}),
		...extra,
	};
}

function booleanProperty(
	displayName: string,
	name: string,
	description: string,
	extra: Partial<INodeProperties> = {},
): INodeProperties {
	return {
		displayName,
		name,
		type: 'boolean',
		default: false,
		description,
		...extra,
	};
}

function fixedCollectionProperty(config: {
	displayName: string;
	name: string;
	placeholder: string;
	itemName: string;
	itemDisplayName: string;
	fields: readonly FixedCollectionField[];
	description?: string;
}): INodeProperties {
	return {
		displayName: config.displayName,
		name: config.name,
		type: 'fixedCollection',
		placeholder: config.placeholder,
		typeOptions: {
			multipleValues: true,
		},
		default: {},
		options: [
			{
				name: config.itemName,
				displayName: config.itemDisplayName,
				values: config.fields.map((field) => ({
					displayName: field.displayName,
					name: field.name,
					type: 'string',
					default: '',
					...(field.placeholder ? { placeholder: field.placeholder } : {}),
				})),
			},
		],
		...(config.description ? { description: config.description } : {}),
	};
}

const ADDITIONAL_OPTION_PROPERTIES: INodeProperties[] = [
	fixedCollectionProperty({
		displayName: 'Add Directories',
		name: 'addDirs',
		placeholder: 'Add Directory',
		itemName: 'directory',
		itemDisplayName: 'Directory',
		fields: [{ displayName: 'Path', name: 'path', placeholder: '/data/shared' }],
		description: 'Additional writable directories passed with repeated --add-dir flags',
	}),
	stringProperty('Codex Binary Path', 'codexBinaryPath', 'Path to the codex executable', {
		default: 'codex',
	}),
	fixedCollectionProperty({
		displayName: 'Config Overrides',
		name: 'configOverrides',
		placeholder: 'Add Override',
		itemName: 'override',
		itemDisplayName: 'Override',
		fields: [
			{ displayName: 'Key', name: 'key', placeholder: 'model_reasoning_effort' },
			{ displayName: 'Value', name: 'value', placeholder: '"high"' },
		],
		description: 'Additional -c key=value overrides. String values must include TOML quotes.',
	}),
	fixedCollectionProperty({
		displayName: 'Disable Features',
		name: 'disableFeatures',
		placeholder: 'Add Feature',
		itemName: 'feature',
		itemDisplayName: 'Feature',
		fields: [{ displayName: 'Name', name: 'name' }],
		description: 'Feature flags passed with repeated --disable flags',
	}),
	fixedCollectionProperty({
		displayName: 'Enable Features',
		name: 'enableFeatures',
		placeholder: 'Add Feature',
		itemName: 'feature',
		itemDisplayName: 'Feature',
		fields: [{ displayName: 'Name', name: 'name' }],
		description: 'Feature flags passed with repeated --enable flags',
	}),
	fixedCollectionProperty({
		displayName: 'Environment Variables',
		name: 'envVars',
		placeholder: 'Add Variable',
		itemName: 'env',
		itemDisplayName: 'Variable',
		fields: [
			{ displayName: 'Name', name: 'name' },
			{ displayName: 'Value', name: 'value' },
		],
	}),
	booleanProperty('Ephemeral', 'ephemeral', 'Whether to run without persisting session files'),
	booleanProperty('Ignore Project Rules', 'ignoreRules', 'Whether to add --ignore-rules'),
	booleanProperty('Ignore User Config', 'ignoreUserConfig', 'Whether to add --ignore-user-config'),
	fixedCollectionProperty({
		displayName: 'Images',
		name: 'images',
		placeholder: 'Add Image',
		itemName: 'image',
		itemDisplayName: 'Image',
		fields: [{ displayName: 'Path', name: 'path', placeholder: '/data/image.png' }],
		description: 'Images passed with repeated --image flags',
	}),
	optionProperty('Local Provider', 'localProvider', LOCAL_PROVIDER_OPTIONS, ''),
	booleanProperty(
		'Network Access',
		'networkAccess',
		'Whether to allow network access in the workspace-write sandbox using sandbox_workspace_write.network_access=true',
	),
	stringProperty(
		'Output Last Message File',
		'outputLastMessageFile',
		'Path passed to --output-last-message',
	),
	{
		displayName: 'Output Schema JSON',
		name: 'outputSchemaJson',
		type: 'json',
		default: '',
		description: 'JSON Schema content. The node writes it to a temporary file and passes --output-schema.',
	},
	stringProperty(
		'Output Schema File',
		'outputSchemaFile',
		'Existing JSON Schema file passed to --output-schema',
	),
	stringProperty('Profile', 'profile', 'Configuration profile from config.toml'),
	stringProperty(
		'Profile V2',
		'profileV2',
		'Config layer loaded from $CODEX_HOME/<name>.config.toml',
	),
	optionProperty(
		'Reasoning Effort',
		'reasoningEffort',
		REASONING_EFFORT_OPTIONS,
		'default',
		'Sets model_reasoning_effort for supported models',
	),
	optionProperty(
		'Reasoning Summary',
		'reasoningSummary',
		REASONING_SUMMARY_OPTIONS,
		'default',
		'Sets model_reasoning_summary for supported models',
	),
	booleanProperty(
		'Skip Git Repo Check',
		'skipGitRepoCheck',
		'Whether to allow running Codex outside a Git repository',
	),
	booleanProperty(
		'Strict Config',
		'strictConfig',
		'Whether Codex should error on unrecognized config.toml fields',
	),
	{
		displayName: 'Timeout (Seconds)',
		name: 'timeout',
		type: 'number',
		default: 600,
		description: 'Kill the codex process after this many seconds',
	},
	optionProperty(
		'Verbosity',
		'verbosity',
		VERBOSITY_OPTIONS,
		'default',
		'Sets model_verbosity for supported models',
	),
	booleanProperty('Use OSS Provider', 'oss', 'Whether to add --oss'),
	optionProperty(
		'Web Search',
		'webSearch',
		WEB_SEARCH_OPTIONS,
		'default',
		'Sets the Codex web_search mode for this run',
	),
	booleanProperty(
		'Bypass Hook Trust',
		'bypassHookTrust',
		'Whether to run enabled hooks without persisted hook trust for this invocation.',
	),
];

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
				options: [...RUN_PROMPT_OPERATION],
				default: 'runPrompt',
			},
			stringProperty('Prompt', 'prompt', 'Prompt sent to Codex as the instruction argument', {
				required: true,
				typeOptions: {
					rows: 6,
				},
			}),
			optionProperty(
				'Output Format',
				'outputFormat',
				OUTPUT_FORMAT_OPTIONS,
				'structured',
			),
			optionProperty(
				'Model',
				'model',
				MODEL_OPTIONS,
				'',
				'Model the Codex CLI should use. Default uses the local Codex config.',
			),
			stringProperty(
				'Custom Model ID',
				'customModel',
				'Exact model ID passed to Codex when Model is Custom',
				{
					placeholder: 'gpt-5.5-codex',
					displayOptions: {
						show: {
							model: ['custom'],
						},
					},
				},
			),
			stringProperty(
				'Working Directory',
				'workingDirectory',
				'Directory passed to Codex with --cd and used as the process cwd',
				{
					placeholder: '/data/projects/my-repo',
				},
			),
			optionProperty('Resume Mode', 'resumeMode', RESUME_MODE_OPTIONS, 'new'),
			stringProperty('Session ID', 'sessionId', undefined, {
				placeholder: '550e8400-e29b-41d4-a716-446655440000',
				displayOptions: {
					show: {
						resumeMode: ['sessionId'],
					},
				},
			}),
			optionProperty(
				'Sandbox Mode',
				'sandboxMode',
				SANDBOX_MODE_OPTIONS,
				'default',
				'Codex sandbox policy for model-generated shell commands',
			),
			optionProperty(
				'Approval Policy',
				'approvalPolicy',
				APPROVAL_POLICY_OPTIONS,
				'default',
				'When Codex should ask for command approval',
			),
			{
				displayName: 'Additional Options',
				name: 'additionalOptions',
				type: 'collection',
				placeholder: 'Add Option',
				default: {},
				options: ADDITIONAL_OPTION_PROPERTIES,
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
	const model = this.getNodeParameter('model', itemIndex, '') as ModelSelection;
	const customModel = this.getNodeParameter('customModel', itemIndex, '') as string;
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

	const preparedSchemaFile = await prepareOutputSchemaFile(additionalOptions);
	const args = buildCodexArgs({
		prompt,
		outputFormat,
		model: resolveModel(model, customModel),
		workingDirectory,
		resumeMode,
		sessionId,
		sandboxMode,
		approvalPolicy,
		additionalOptions,
		outputSchemaFile: preparedSchemaFile.path,
	});

	const codexBinaryPath =
		((additionalOptions.codexBinaryPath as string) || '').trim() || 'codex';
	const timeoutMs = (((additionalOptions.timeout as number) || 600) as number) * 1000;

	const env = buildCodexEnvironment(additionalOptions);
	const cwd = workingDirectory.trim() || undefined;
	let stdout: string;
	try {
		({ stdout } = await spawnCodex(
			codexBinaryPath,
			args,
			cwd,
			env,
			timeoutMs,
		));
	} finally {
		await preparedSchemaFile.cleanup();
	}

	if (outputFormat === 'text') {
		return {
			text: stdout.replace(/\s+$/, ''),
		};
	}

	const events = parseJsonLines(stdout);

	if (outputFormat === 'json') {
		return {
			events: events as unknown as IDataObject[],
		};
	}

	const summary = summarizeEvents(events);
	return summary as unknown as IDataObject;
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
	additionalOptions: IDataObject;
	outputSchemaFile: string | undefined;
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
		additionalOptions,
		outputSchemaFile,
	} = options;
	const args: string[] = ['exec'];

	if (resumeMode !== 'new') args.push('resume');

	appendCommonExecArgs(args, {
		outputFormat,
		model,
		approvalPolicy,
		additionalOptions,
		outputSchemaFile,
	});

	if (resumeMode === 'new') {
		appendNewExecArgs(args, {
			workingDirectory,
			sandboxMode,
			additionalOptions,
		});
		return [...args, prompt];
	}

	if (resumeMode === 'last') {
		return [...args, '--last', prompt];
	}

	return [...args, sessionId.trim(), prompt];
}

function appendCommonExecArgs(
	args: string[],
	options: {
		outputFormat: OutputFormat;
		model: string;
		approvalPolicy: ApprovalPolicy;
		additionalOptions: IDataObject;
		outputSchemaFile: string | undefined;
	},
): void {
	const { outputFormat, model, approvalPolicy, additionalOptions, outputSchemaFile } =
		options;

	appendConfigArgs(args, approvalPolicy, additionalOptions);
	appendRepeated(
		args,
		'--enable',
		collectionStrings(additionalOptions.enableFeatures, 'feature', 'name'),
	);
	appendRepeated(
		args,
		'--disable',
		collectionStrings(additionalOptions.disableFeatures, 'feature', 'name'),
	);

	if (additionalOptions.strictConfig === true) args.push('--strict-config');
	appendRepeated(
		args,
		'--image',
		collectionStrings(additionalOptions.images, 'image', 'path'),
	);

	if (model) args.push('--model', model);

	if (additionalOptions.bypassHookTrust === true) {
		args.push('--dangerously-bypass-hook-trust');
	}
	if (additionalOptions.skipGitRepoCheck === true) args.push('--skip-git-repo-check');
	if (additionalOptions.ephemeral === true) args.push('--ephemeral');
	if (additionalOptions.ignoreUserConfig === true) args.push('--ignore-user-config');
	if (additionalOptions.ignoreRules === true) args.push('--ignore-rules');
	if (outputSchemaFile) args.push('--output-schema', outputSchemaFile);
	if (outputFormat !== 'text') args.push('--json');

	const outputLastMessageFile = stringOption(additionalOptions.outputLastMessageFile);
	if (outputLastMessageFile) {
		args.push('--output-last-message', outputLastMessageFile);
	}
}

function appendNewExecArgs(
	args: string[],
	options: {
		workingDirectory: string;
		sandboxMode: SandboxMode;
		additionalOptions: IDataObject;
	},
): void {
	const { workingDirectory, sandboxMode, additionalOptions } = options;

	const profile = stringOption(additionalOptions.profile);
	if (profile) args.push('--profile', profile);

	const profileV2 = stringOption(additionalOptions.profileV2);
	if (profileV2) args.push('--profile-v2', profileV2);

	if (additionalOptions.oss === true) args.push('--oss');

	const localProvider = stringOption(additionalOptions.localProvider);
	if (localProvider) args.push('--local-provider', localProvider);

	if (sandboxMode !== 'default') args.push('--sandbox', sandboxMode);
	if (workingDirectory.trim()) args.push('--cd', workingDirectory.trim());

	appendRepeated(
		args,
		'--add-dir',
		collectionStrings(additionalOptions.addDirs, 'directory', 'path'),
	);

	args.push('--color', 'never');
}

function appendConfigArgs(
	args: string[],
	approvalPolicy: ApprovalPolicy,
	additionalOptions: IDataObject,
): void {
	for (const override of configOverrideValues(additionalOptions.configOverrides)) {
		args.push('-c', override);
	}

	if (approvalPolicy !== 'default') {
		args.push('-c', `approval_policy="${approvalPolicy}"`);
	}

	const reasoningEffort = enumOption<ReasoningEffort>(
		additionalOptions.reasoningEffort,
		'default',
	);
	if (reasoningEffort !== 'default') {
		args.push('-c', `model_reasoning_effort="${reasoningEffort}"`);
	}

	const reasoningSummary = enumOption<ReasoningSummary>(
		additionalOptions.reasoningSummary,
		'default',
	);
	if (reasoningSummary !== 'default') {
		args.push('-c', `model_reasoning_summary="${reasoningSummary}"`);
	}

	const verbosity = enumOption<ModelVerbosity>(additionalOptions.verbosity, 'default');
	if (verbosity !== 'default') {
		args.push('-c', `model_verbosity="${verbosity}"`);
	}

	const webSearch = enumOption<WebSearchMode>(additionalOptions.webSearch, 'default');
	if (webSearch !== 'default') {
		args.push('-c', `web_search="${webSearch}"`);
	}

	if (additionalOptions.networkAccess === true) {
		args.push('-c', 'sandbox_workspace_write.network_access=true');
	}
}

function resolveModel(model: ModelSelection, customModel: string): string {
	if (model === 'custom') {
		const trimmedCustomModel = customModel.trim();
		if (!trimmedCustomModel) {
			throw new Error('Custom Model ID is required when Model is Custom');
		}
		return trimmedCustomModel;
	}
	return model;
}

async function prepareOutputSchemaFile(
	additionalOptions: IDataObject,
): Promise<PreparedSchemaFile> {
	const outputSchemaFile = stringOption(additionalOptions.outputSchemaFile);
	const outputSchemaJson = stringOption(additionalOptions.outputSchemaJson);

	if (outputSchemaFile && outputSchemaJson) {
		throw new Error('Use either Output Schema JSON or Output Schema File, not both');
	}

	if (outputSchemaFile) {
		return {
			path: outputSchemaFile,
			cleanup: async () => {},
		};
	}

	if (!outputSchemaJson) {
		return {
			path: undefined,
			cleanup: async () => {},
		};
	}

	JSON.parse(outputSchemaJson);
	const tempDir = await fs.mkdtemp(join(tmpdir(), 'n8n-codex-schema-'));
	const schemaPath = join(tempDir, 'schema.json');
	await fs.writeFile(schemaPath, outputSchemaJson, 'utf8');
	return {
		path: schemaPath,
		cleanup: async () => {
			await fs.rm(tempDir, { recursive: true, force: true });
		},
	};
}

function buildCodexEnvironment(additionalOptions: IDataObject): NodeJS.ProcessEnv {
	const env: NodeJS.ProcessEnv = { ...process.env };
	env.HOME = env.HOME ?? homedir();
	if (env.HOME && !env.CODEX_HOME) {
		env.CODEX_HOME = join(env.HOME, '.codex');
	}
	env.PATH = mergePathEntries(env.PATH, [
		'/opt/homebrew/bin',
		'/usr/local/bin',
		'/usr/bin',
		'/bin',
		'/usr/sbin',
		'/sbin',
	]);

	const envVarsCollection = asRecord(additionalOptions.envVars);
	const envVars = envVarsCollection?.env;
	if (Array.isArray(envVars)) {
		for (const v of envVars as EnvVarItem[]) {
			if (v && v.name) env[v.name] = v.value ?? '';
		}
	}
	return env;
}

function mergePathEntries(currentPath: string | undefined, requiredEntries: string[]): string {
	const existingEntries = currentPath ? currentPath.split(':').filter(Boolean) : [];
	const mergedEntries = [...requiredEntries];
	for (const entry of existingEntries) {
		if (!mergedEntries.includes(entry)) mergedEntries.push(entry);
	}
	return mergedEntries.join(':');
}

function spawnCodex(
	binary: string,
	args: string[],
	cwd: string | undefined,
	env: NodeJS.ProcessEnv,
	timeoutMs: number,
): Promise<{ stdout: string }> {
	return new Promise((resolve, reject) => {
		const child = spawn(binary, args, {
			cwd,
			env,
			stdio: ['ignore', 'pipe', 'pipe'],
		});

		let stdout = '';
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
		child.stderr?.on('data', () => {});

		child.on('error', (err) => {
			clearTimeout(timer);
			reject(new Error(`Failed to spawn Codex process: ${err.name}`));
		});

		child.on('close', (code, signal) => {
			clearTimeout(timer);
			if (timedOut) {
				return reject(
					new Error(`codex timed out after ${timeoutMs / 1000}s`),
				);
			}
			if (signal) {
				return reject(new Error(`codex exited from signal ${signal}`));
			}
			if (code !== 0) {
				return reject(new Error(`codex exited with code ${code}`));
			}
			resolve({ stdout });
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
		const payload = asRecord(event.payload);
		const type = stringValue(event.type);
		const payloadType = stringValue(payload?.type);
		if (type) summary.lastEventType = type;
		else if (payloadType) summary.lastEventType = payloadType;

		const sessionId =
			firstString(
				event.session_id,
				event.sessionId,
				event.conversation_id,
				event.conversationId,
				payload?.session_id,
				payload?.sessionId,
				payload?.conversation_id,
				payload?.conversationId,
			);
		if (sessionId && !summary.sessionId) summary.sessionId = sessionId;

		const threadId = firstString(
			event.thread_id,
			event.threadId,
			payload?.thread_id,
			payload?.threadId,
		);
		if (threadId && !summary.threadId) summary.threadId = threadId;

		const model = firstString(
			event.model,
			getNested(event, ['message', 'model']),
			payload?.model,
			getNested(payload, ['message', 'model']),
		);
		if (model && !summary.model) summary.model = model;

		const status =
			firstString(
				event.status,
				event.outcome,
				event.terminal_reason,
				payload?.status,
				payload?.outcome,
				payload?.terminal_reason,
			);
		if (status) summary.status = status;

		if (event.usage !== undefined) summary.usage = event.usage;
		else if (payload?.usage !== undefined) summary.usage = payload.usage;

		if (
			event.error !== undefined ||
			payload?.error !== undefined ||
			event.is_error === true ||
			payload?.is_error === true ||
			type?.includes('error') ||
			payloadType?.includes('error')
		) {
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
	for (const source of eventSources(event)) {
		const message = asRecord(source.message);
		if (message) {
			const role = stringValue(message.role) ?? inferRoleFromSource(source, event) ?? 'assistant';
			const content = message.content ?? message.text ?? message.message;
			return {
				role,
				content,
				text: extractText(content),
			};
		}

		const item = asRecord(source.item);
		if (item && (item.type === 'message' || item.role !== undefined)) {
			const role = stringValue(item.role) ?? inferRoleFromSource(source, event) ?? 'assistant';
			const content = item.content ?? item.text ?? item.message;
			return {
				role,
				content,
				text: extractText(content),
			};
		}

		const sourceType = typeForSource(source, event);
		if (sourceType === 'message' || source.role !== undefined) {
			const content = source.content ?? source.text ?? source.message;
			if (content !== undefined) {
				return {
					role: stringValue(source.role) ?? inferRoleFromSource(source, event) ?? 'assistant',
					content,
					text: extractText(content),
				};
			}
		}

		if (sourceType.includes('message')) {
			const content = source.text ?? source.message ?? source.content;
			const text = extractText(content);
			if (text) {
				return {
					role: inferRoleFromSource(source, event) ?? 'assistant',
					content,
					text,
				};
			}
		}
	}

	return undefined;
}

function extractToolCall(event: JsonEvent): ToolCallSummary | undefined {
	for (const eventSource of eventSources(event)) {
		const item = asRecord(eventSource.item);
		const source = item ?? eventSource;
		const type = typeForSource(source, event);
		if (
			!type.includes('tool') &&
			!type.includes('function_call') &&
			source.name === undefined &&
			source.tool_name === undefined
		) {
			continue;
		}

		return {
			id: firstString(source.id, source.call_id),
			name:
				firstString(source.name, source.tool_name, getNested(source, ['function', 'name'])),
			status: stringValue(source.status),
			input: source.input ?? source.arguments ?? getNested(source, ['function', 'arguments']),
			output: source.output ?? source.result,
		};
	}

	return undefined;
}

function extractExplicitFinalText(event: JsonEvent): string | undefined {
	const types = eventSources(event).map((source) => typeForSource(source, event));
	if (types.some(isFinalEventType)) {
		for (const source of eventSources(event)) {
			const text =
				firstString(
					source.last_agent_message,
					source.lastAgentMessage,
					source.final_response,
					source.finalResponse,
					source.response,
					source.output,
					source.text,
				) ??
				extractText(source.message) ??
				extractText(source.content);
			if (text) return text;
		}
	}
	return undefined;
}

function isFinalEventType(type: string): boolean {
	return (
		type.includes('final') ||
		type === 'agent_message' ||
		type === 'response.completed' ||
		type === 'turn.completed' ||
		type === 'task_complete' ||
		type === 'task.completed'
	);
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

function inferRoleFromSource(
	source: Record<string, unknown>,
	event: JsonEvent,
): string | undefined {
	return stringValue(source.role) ?? inferRoleFromType(typeForSource(source, event));
}

function inferRoleFromType(type: string): string | undefined {
	if (type.includes('assistant') || type.includes('agent')) return 'assistant';
	if (type.includes('user')) return 'user';
	if (type.includes('system')) return 'system';
	return undefined;
}

function eventSources(event: JsonEvent): Record<string, unknown>[] {
	const sources: Record<string, unknown>[] = [event];
	const payload = asRecord(event.payload);
	if (payload) sources.push(payload);
	const item = asRecord(event.item);
	if (item) sources.push(item);
	return sources;
}

function typeForSource(source: Record<string, unknown>, event: JsonEvent): string {
	return stringValue(source.type) ?? (source === event ? undefined : stringValue(event.type)) ?? '';
}

function stringOption(value: unknown): string {
	return typeof value === 'string' ? value.trim() : '';
}

function enumOption<T extends string>(value: unknown, defaultValue: T): T {
	return typeof value === 'string' && value.length > 0 ? (value as T) : defaultValue;
}

function collectionItems(value: unknown, collectionName: string): IDataObject[] {
	const collection = asRecord(value);
	if (!collection) return [];
	const items = collection[collectionName];
	if (!Array.isArray(items)) return [];
	return items as IDataObject[];
}

function collectionStrings(
	value: unknown,
	collectionName: string,
	propertyName: string,
): string[] {
	const values: string[] = [];
	for (const item of collectionItems(value, collectionName)) {
		const fieldValue = stringOption(item[propertyName]);
		if (fieldValue) values.push(fieldValue);
	}
	return values;
}

function configOverrideValues(value: unknown): string[] {
	const values: string[] = [];
	for (const item of collectionItems(value, 'override')) {
		const key = stringOption(item.key);
		const overrideValue = stringOption(item.value);
		if (!key && !overrideValue) continue;
		if (!key || !overrideValue) {
			throw new Error('Config Override rows require both Key and Value');
		}
		values.push(`${key}=${overrideValue}`);
	}
	return values;
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

function firstString(...values: unknown[]): string | undefined {
	for (const value of values) {
		const text = stringValue(value);
		if (text) return text;
	}
	return undefined;
}
