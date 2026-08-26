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

const CONFIG_BOOLEAN_OPTIONS = [
	{
		name: 'Use Codex Default',
		value: 'default',
		description: 'Do not pass this config key for this run.',
	},
	{
		name: 'Enabled',
		value: 'true',
		description: 'Pass this config key as true.',
	},
	{
		name: 'Disabled',
		value: 'false',
		description: 'Pass this config key as false.',
	},
] as const;

const HISTORY_PERSISTENCE_OPTIONS = [
	{ name: 'Use Codex Default', value: 'default' },
	{ name: 'Save All', value: 'save-all' },
	{ name: 'None', value: 'none' },
] as const;

const FILE_OPENER_OPTIONS = [
	{ name: 'Use Codex Default', value: 'default' },
	{ name: 'VS Code', value: 'vscode' },
	{ name: 'VS Code Insiders', value: 'vscode-insiders' },
	{ name: 'Windsurf', value: 'windsurf' },
	{ name: 'Cursor', value: 'cursor' },
	{ name: 'None', value: 'none' },
] as const;

const SHELL_ENVIRONMENT_INHERIT_OPTIONS = [
	{ name: 'Use Codex Default', value: 'default' },
	{ name: 'All', value: 'all' },
	{ name: 'Core', value: 'core' },
	{ name: 'None', value: 'none' },
] as const;

const AUTH_CREDENTIALS_STORE_OPTIONS = [
	{ name: 'Use Codex Default', value: 'default' },
	{ name: 'Auto', value: 'auto' },
	{ name: 'File', value: 'file' },
	{ name: 'Keyring', value: 'keyring' },
] as const;

const APPROVALS_REVIEWER_OPTIONS = [
	{ name: 'Use Codex Default', value: 'default' },
	{ name: 'User', value: 'user' },
	{ name: 'Auto Review', value: 'auto_review' },
] as const;

const CONFIG_APPROVAL_MODE_OPTIONS = [
	{ name: 'Use Codex Default', value: 'default' },
	{ name: 'Auto', value: 'auto' },
	{ name: 'Prompt', value: 'prompt' },
	{ name: 'Approve', value: 'approve' },
] as const;

const PERSONALITY_OPTIONS = [
	{ name: 'Use Codex Default', value: 'default' },
	{ name: 'None', value: 'none' },
	{ name: 'Friendly', value: 'friendly' },
	{ name: 'Pragmatic', value: 'pragmatic' },
] as const;

const AUTO_COMPACT_TOKEN_LIMIT_SCOPE_OPTIONS = [
	{ name: 'Use Codex Default', value: 'default' },
	{ name: 'Total', value: 'total' },
	{ name: 'Body After Prefix', value: 'body_after_prefix' },
] as const;

const WINDOWS_SANDBOX_OPTIONS = [
	{ name: 'Use Codex Default', value: 'default' },
	{ name: 'Unelevated', value: 'unelevated' },
	{ name: 'Elevated', value: 'elevated' },
] as const;

const TUI_ALTERNATE_SCREEN_OPTIONS = [
	{ name: 'Use Codex Default', value: 'default' },
	{ name: 'Auto', value: 'auto' },
	{ name: 'Always', value: 'always' },
	{ name: 'Never', value: 'never' },
] as const;

const TUI_NOTIFICATION_METHOD_OPTIONS = [
	{ name: 'Use Codex Default', value: 'default' },
	{ name: 'Auto', value: 'auto' },
	{ name: 'OSC 9', value: 'osc9' },
	{ name: 'Bell', value: 'bel' },
] as const;

const TUI_NOTIFICATION_CONDITION_OPTIONS = [
	{ name: 'Use Codex Default', value: 'default' },
	{ name: 'Unfocused', value: 'unfocused' },
	{ name: 'Always', value: 'always' },
] as const;

const FORCED_LOGIN_METHOD_OPTIONS = [
	{ name: 'Use Codex Default', value: 'default' },
	{ name: 'ChatGPT', value: 'chatgpt' },
	{ name: 'API', value: 'api' },
] as const;

const MCP_ENVIRONMENT_OPTIONS = [
	{ name: 'Use Codex Default', value: 'default' },
	{ name: 'Local', value: 'local' },
	{ name: 'Remote', value: 'remote' },
] as const;

const PROJECT_TRUST_LEVEL_OPTIONS = [
	{ name: 'Use Codex Default', value: 'default' },
	{ name: 'Trusted', value: 'trusted' },
	{ name: 'Untrusted', value: 'untrusted' },
] as const;

const OTEL_EXPORTER_OPTIONS = [
	{ name: 'Use Codex Default', value: 'default' },
	{ name: 'None', value: 'none' },
	{ name: 'OTLP HTTP', value: 'otlp-http' },
	{ name: 'OTLP gRPC', value: 'otlp-grpc' },
] as const;

const OTEL_METRICS_EXPORTER_OPTIONS = [
	{ name: 'Use Codex Default', value: 'default' },
	{ name: 'None', value: 'none' },
	{ name: 'Statsig', value: 'statsig' },
	{ name: 'OTLP HTTP', value: 'otlp-http' },
	{ name: 'OTLP gRPC', value: 'otlp-grpc' },
] as const;

const OTEL_PROTOCOL_OPTIONS = [
	{ name: 'Use Codex Default', value: 'default' },
	{ name: 'Binary', value: 'binary' },
	{ name: 'JSON', value: 'json' },
] as const;

const FEATURE_FLAG_STATE_OPTIONS = [
	{ name: 'Choose State', value: 'default' },
	{ name: 'Enabled', value: 'true' },
	{ name: 'Disabled', value: 'false' },
] as const;

const FEATURE_FLAG_OPTIONS = [
	{ name: 'Apply Patch Freeform', value: 'apply_patch_freeform' },
	{
		name: 'Apply Patch Streaming Events',
		value: 'apply_patch_streaming_events',
	},
	{
		name: 'Apps',
		value: 'apps',
		description: 'Enable ChatGPT Apps/connectors support.',
	},
	{ name: 'Apps MCP Path Override', value: 'apps_mcp_path_override' },
	{ name: 'Auth Elicitation', value: 'auth_elicitation' },
	{ name: 'Browser Use', value: 'browser_use' },
	{ name: 'Browser Use External', value: 'browser_use_external' },
	{ name: 'Built-In MCP', value: 'builtin_mcp' },
	{ name: 'Child AGENTS.md', value: 'child_agents_md' },
	{ name: 'Chronicle', value: 'chronicle' },
	{ name: 'Code Mode', value: 'code_mode' },
	{ name: 'Code Mode Only', value: 'code_mode_only' },
	{ name: 'Codex Git Commit', value: 'codex_git_commit' },
	{ name: 'Codex Hooks', value: 'codex_hooks' },
	{ name: 'Collab', value: 'collab' },
	{ name: 'Collaboration Modes', value: 'collaboration_modes' },
	{ name: 'Computer Use', value: 'computer_use' },
	{ name: 'Connectors', value: 'connectors' },
	{
		name: 'Default Mode Request User Input',
		value: 'default_mode_request_user_input',
	},
	{ name: 'Elevated Windows Sandbox', value: 'elevated_windows_sandbox' },
	{
		name: 'Enable Experimental Windows Sandbox',
		value: 'enable_experimental_windows_sandbox',
	},
	{ name: 'Enable Fanout', value: 'enable_fanout' },
	{ name: 'Enable MCP Apps', value: 'enable_mcp_apps' },
	{
		name: 'Enable Request Compression',
		value: 'enable_request_compression',
		description: 'Compress request bodies when supported.',
	},
	{ name: 'Exec Permission Approvals', value: 'exec_permission_approvals' },
	{
		name: 'Experimental Unified Exec Tool',
		value: 'experimental_use_unified_exec_tool',
	},
	{
		name: 'Experimental Windows Sandbox',
		value: 'experimental_windows_sandbox',
	},
	{ name: 'External Migration', value: 'external_migration' },
	{ name: 'Fast Mode', value: 'fast_mode' },
	{ name: 'Goals', value: 'goals' },
	{ name: 'Guardian Approval', value: 'guardian_approval' },
	{
		name: 'Hooks',
		value: 'hooks',
		description:
			'Enable lifecycle hooks loaded from hooks.json or inline config.',
	},
	{ name: 'Image Detail Original', value: 'image_detail_original' },
	{ name: 'Image Generation', value: 'image_generation' },
	{ name: 'In-App Browser', value: 'in_app_browser' },
	{ name: 'JS REPL', value: 'js_repl' },
	{ name: 'JS REPL Tools Only', value: 'js_repl_tools_only' },
	{ name: 'Memories', value: 'memories' },
	{ name: 'Memory Tool', value: 'memory_tool' },
	{ name: 'Mentions V2', value: 'mentions_v2' },
	{
		name: 'Multi-Agent',
		value: 'multi_agent',
		description: 'Enable subagent collaboration tools.',
	},
	{ name: 'Multi-Agent V2', value: 'multi_agent_v2' },
	{ name: 'Network Proxy', value: 'network_proxy' },
	{ name: 'Personality', value: 'personality' },
	{
		name: 'Plugin Hooks',
		value: 'plugin_hooks',
		description: 'Enable lifecycle hooks bundled with enabled plugins.',
	},
	{ name: 'Plugin Sharing', value: 'plugin_sharing' },
	{
		name: 'Plugins',
		value: 'plugins',
		description:
			'Enable installed plugins, including plugin-provided MCP servers.',
	},
	{ name: 'Prevent Idle Sleep', value: 'prevent_idle_sleep' },
	{ name: 'Realtime Conversation', value: 'realtime_conversation' },
	{ name: 'Remote Compaction V2', value: 'remote_compaction_v2' },
	{ name: 'Remote Control', value: 'remote_control' },
	{ name: 'Remote Models', value: 'remote_models' },
	{ name: 'Remote Plugin', value: 'remote_plugin' },
	{ name: 'Request Permissions', value: 'request_permissions' },
	{ name: 'Request Permissions Tool', value: 'request_permissions_tool' },
	{ name: 'Request Rule', value: 'request_rule' },
	{
		name: 'Responses Websocket Response Processed',
		value: 'responses_websocket_response_processed',
	},
	{ name: 'Responses Websockets', value: 'responses_websockets' },
	{ name: 'Responses Websockets V2', value: 'responses_websockets_v2' },
	{ name: 'Runtime Metrics', value: 'runtime_metrics' },
	{ name: 'Search Tool', value: 'search_tool' },
	{ name: 'Shell Snapshot', value: 'shell_snapshot' },
	{
		name: 'Shell Tool',
		value: 'shell_tool',
		description: 'Enable the default shell tool for running commands.',
	},
	{ name: 'Shell Zsh Fork', value: 'shell_zsh_fork' },
	{
		name: 'Skill Environment Variable Dependency Prompt',
		value: 'skill_env_var_dependency_prompt',
	},
	{
		name: 'Skill MCP Dependency Install',
		value: 'skill_mcp_dependency_install',
	},
	{ name: 'SQLite', value: 'sqlite' },
	{ name: 'Steer', value: 'steer' },
	{ name: 'Telepathy', value: 'telepathy' },
	{ name: 'Terminal Resize Reflow', value: 'terminal_resize_reflow' },
	{ name: 'Tool Call MCP Elicitation', value: 'tool_call_mcp_elicitation' },
	{ name: 'Tool Search', value: 'tool_search' },
	{
		name: 'Tool Search Always Defer MCP Tools',
		value: 'tool_search_always_defer_mcp_tools',
	},
	{ name: 'Tool Suggest', value: 'tool_suggest' },
	{ name: 'TUI App Server', value: 'tui_app_server' },
	{ name: 'Unavailable Dummy Tools', value: 'unavailable_dummy_tools' },
	{ name: 'Undo', value: 'undo' },
	{ name: 'Unified Exec', value: 'unified_exec' },
	{ name: 'Use Legacy Landlock', value: 'use_legacy_landlock' },
	{ name: 'Use Linux Sandbox Bwrap', value: 'use_linux_sandbox_bwrap' },
	{ name: 'Web Search', value: 'web_search' },
	{ name: 'Web Search Cached', value: 'web_search_cached' },
	{ name: 'Web Search Request', value: 'web_search_request' },
	{ name: 'Workspace Dependencies', value: 'workspace_dependencies' },
	{ name: 'Workspace Owner Usage Nudge', value: 'workspace_owner_usage_nudge' },
] as const;

const DOCUMENTED_ADVANCED_CONFIG_OPTIONS = [
	{
		name: 'Hooks',
		value: 'hooks',
		description:
			'Lifecycle hooks configured inline in config.toml. Enter the resolved hooks.<Event>... key and TOML value.',
	},
	{
		name: 'Model Provider',
		value: 'model_providers.<id>',
		description:
			'User-defined model provider entries. Enter the resolved model_providers.<id>... key and TOML value.',
	},
	{
		name: 'MCP Env Vars',
		value: 'mcp_servers.<id>.env_vars',
		description:
			'Environment variable whitelist for an MCP stdio server. Enter a TOML array value.',
	},
	{
		name: 'MCP Advanced Map',
		value: 'mcp_servers.<id>.*',
		description:
			'Advanced MCP server fields not covered by dedicated controls, such as nested maps.',
	},
	{
		name: 'Tool Suggest Discoverables',
		value: 'tool_suggest.discoverables',
		description:
			'Allow tool suggestions for additional connectors or plugins. Enter a TOML array-of-tables value.',
	},
	{
		name: 'Tool Suggest Disabled Tools',
		value: 'tool_suggest.disabled_tools',
		description:
			'Disable suggestions for specific connectors or plugins. Enter a TOML array-of-tables value.',
	},
	{
		name: 'Tools Web Search',
		value: 'tools.web_search',
		description:
			'Optional web search tool object config, including context size, allowed domains, and location.',
	},
	{
		name: 'Permission Workspace Roots',
		value: 'permissions.<name>.workspace_roots',
		description:
			'Named permission profile workspace roots. Enter a resolved key and TOML value.',
	},
	{
		name: 'Permission Filesystem Advanced',
		value: 'permissions.<name>.filesystem.*',
		description:
			'Advanced filesystem permission profile entries, including nested workspace-root rules.',
	},
	{
		name: 'Permission Network Unix Sockets',
		value: 'permissions.<name>.network.unix_sockets.*',
		description: 'Unix socket allowlist overrides for sandboxed networking.',
	},
	{
		name: 'Plugin Config',
		value: 'plugins.<plugin>.*',
		description: 'User-level plugin config entries keyed by plugin name.',
	},
	{
		name: 'Profile Config',
		value: 'profiles.<name>.*',
		description:
			'Profile-scoped overrides for any supported configuration key.',
	},
	{
		name: 'TUI Keymap',
		value: 'tui.keymap.<context>.<action>',
		description:
			'Keyboard shortcut binding or empty array unbind for a TUI action.',
	},
	{
		name: 'TUI Model Availability NUX',
		value: 'tui.model_availability_nux.<model>',
		description: 'Internal startup-tooltip state keyed by model slug.',
	},
	{
		name: 'Notice Model Migrations',
		value: 'notice.model_migrations',
		description: 'Track acknowledged model migrations as old-to-new mappings.',
	},
	{
		name: 'Marketplace Config',
		value: 'marketplaces.<name>.*',
		description: 'User-level marketplace entries keyed by marketplace name.',
	},
	{
		name: 'Realtime Config',
		value: 'realtime.*',
		description: 'Experimental realtime websocket session selection settings.',
	},
	{
		name: 'Audio Config',
		value: 'audio.*',
		description: 'Audio-related Codex configuration from the current schema.',
	},
	{
		name: 'Desktop Config',
		value: 'desktop.*',
		description:
			'Desktop-app-specific Codex configuration from the current schema.',
	},
	{
		name: 'Debug Config',
		value: 'debug.*',
		description: 'Debug configuration from the current schema.',
	},
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

const BOOLEAN_CONFIG_OVERRIDES = [
	{
		optionName: 'allowLoginShell',
		configKey: 'allow_login_shell',
		displayName: 'Config: Allow Login Shell',
		description:
			'Allow shell-based tools to use login-shell semantics. Disable for more deterministic non-interactive runs.',
	},
	{
		optionName: 'analyticsEnabled',
		configKey: 'analytics.enabled',
		displayName: 'Config: Analytics Enabled',
		description: 'Enable or disable analytics for this Codex invocation.',
	},
	{
		optionName: 'approvalPolicyGranularMcpElicitations',
		configKey: 'approval_policy.granular.mcp_elicitations',
		displayName: 'Config: Granular Approval MCP Elicitations',
		description:
			'Allow MCP elicitation prompts to surface under granular approval policy.',
	},
	{
		optionName: 'approvalPolicyGranularRequestPermissions',
		configKey: 'approval_policy.granular.request_permissions',
		displayName: 'Config: Granular Approval Request Permissions',
		description:
			'Allow request_permissions prompts to surface under granular approval policy.',
	},
	{
		optionName: 'approvalPolicyGranularRules',
		configKey: 'approval_policy.granular.rules',
		displayName: 'Config: Granular Approval Rules',
		description:
			'Allow exec policy rule approval prompts under granular approval policy.',
	},
	{
		optionName: 'approvalPolicyGranularSandboxApproval',
		configKey: 'approval_policy.granular.sandbox_approval',
		displayName: 'Config: Granular Approval Sandbox',
		description:
			'Allow sandbox escalation prompts under granular approval policy.',
	},
	{
		optionName: 'approvalPolicyGranularSkillApproval',
		configKey: 'approval_policy.granular.skill_approval',
		displayName: 'Config: Granular Approval Skill Approval',
		description:
			'Allow skill-script approval prompts under granular approval policy.',
	},
	{
		optionName: 'appsDefaultDestructiveEnabled',
		configKey: 'apps._default.destructive_enabled',
		displayName: 'Config: Default Apps Destructive Tools',
		description:
			'Default allow or deny for app tools that advertise destructive behavior.',
	},
	{
		optionName: 'appsDefaultEnabled',
		configKey: 'apps._default.enabled',
		displayName: 'Config: Default Apps Enabled',
		description: 'Default app enabled state unless overridden per app.',
	},
	{
		optionName: 'appsDefaultOpenWorldEnabled',
		configKey: 'apps._default.open_world_enabled',
		displayName: 'Config: Default Apps Open World Tools',
		description:
			'Default allow or deny for app tools that advertise open-world behavior.',
	},
	{
		optionName: 'checkForUpdateOnStartup',
		configKey: 'check_for_update_on_startup',
		displayName: 'Config: Check For Updates',
		description:
			'Check for Codex updates on startup. Disable in centrally managed automation.',
	},
	{
		optionName: 'disablePasteBurst',
		configKey: 'disable_paste_burst',
		displayName: 'Config: Disable Paste Burst',
		description: 'Disable burst-paste detection for typed input.',
	},
	{
		optionName: 'feedbackEnabled',
		configKey: 'feedback.enabled',
		displayName: 'Config: Feedback Enabled',
		description:
			'Enable or disable feedback collection across Codex product surfaces.',
	},
	{
		optionName: 'hideAgentReasoning',
		configKey: 'hide_agent_reasoning',
		displayName: 'Config: Hide Agent Reasoning',
		description: 'Hide AgentReasoning events from UI and exec output.',
	},
	{
		optionName: 'includeAppsInstructions',
		configKey: 'include_apps_instructions',
		displayName: 'Config: Include Apps Instructions',
		description: 'Inject the apps developer instruction block into the prompt.',
	},
	{
		optionName: 'includeCollaborationModeInstructions',
		configKey: 'include_collaboration_mode_instructions',
		displayName: 'Config: Include Collaboration Mode Instructions',
		description:
			'Inject the collaboration-mode developer instruction block into the prompt.',
	},
	{
		optionName: 'includeEnvironmentContext',
		configKey: 'include_environment_context',
		displayName: 'Config: Include Environment Context',
		description: 'Inject the environment-context user block into the prompt.',
	},
	{
		optionName: 'includePermissionsInstructions',
		configKey: 'include_permissions_instructions',
		displayName: 'Config: Include Permissions Instructions',
		description:
			'Inject the permissions developer instruction block into the prompt.',
	},
	{
		optionName: 'memoriesDisableOnExternalContext',
		configKey: 'memories.disable_on_external_context',
		displayName: 'Config: Disable Memories On External Context',
		description:
			'Prevent memory generation for threads that use external context.',
	},
	{
		optionName: 'memoriesGenerateMemories',
		configKey: 'memories.generate_memories',
		displayName: 'Config: Generate Memories',
		description:
			'Allow newly created threads to be stored as memory-generation inputs.',
	},
	{
		optionName: 'memoriesUseMemories',
		configKey: 'memories.use_memories',
		displayName: 'Config: Use Memories',
		description:
			'Allow Codex to inject existing memories into future sessions.',
	},
	{
		optionName: 'modelSupportsReasoningSummaries',
		configKey: 'model_supports_reasoning_summaries',
		displayName: 'Config: Model Supports Reasoning Summaries',
		description:
			'Force reasoning summary support on or off for the configured model.',
	},
	{
		optionName: 'noticeHideFullAccessWarning',
		configKey: 'notice.hide_full_access_warning',
		displayName: 'Config: Hide Full Access Warning Notice',
		description: 'Track acknowledgement of the full-access warning prompt.',
	},
	{
		optionName: 'noticeHideGpt51MigrationPrompt',
		configKey: 'notice.hide_gpt5_1_migration_prompt',
		displayName: 'Config: Hide GPT-5.1 Migration Prompt',
		description: 'Track acknowledgement of the GPT-5.1 migration prompt.',
	},
	{
		optionName: 'noticeHideGpt51CodexMaxMigrationPrompt',
		configKey: 'notice.hide_gpt-5.1-codex-max_migration_prompt',
		displayName: 'Config: Hide GPT-5.1 Codex Max Migration Prompt',
		description:
			'Track acknowledgement of the gpt-5.1-codex-max migration prompt.',
	},
	{
		optionName: 'noticeHideRateLimitModelNudge',
		configKey: 'notice.hide_rate_limit_model_nudge',
		displayName: 'Config: Hide Rate Limit Model Nudge',
		description: 'Track opt-out of the rate-limit model switch reminder.',
	},
	{
		optionName: 'noticeHideWorldWritableWarning',
		configKey: 'notice.hide_world_writable_warning',
		displayName: 'Config: Hide World Writable Warning',
		description:
			'Track acknowledgement of the Windows world-writable directory warning.',
	},
	{
		optionName: 'otelLogUserPrompt',
		configKey: 'otel.log_user_prompt',
		displayName: 'Config: OTEL Log User Prompt',
		description: 'Opt in to exporting raw user prompts with telemetry logs.',
	},
	{
		optionName: 'sandboxWorkspaceWriteExcludeSlashTmp',
		configKey: 'sandbox_workspace_write.exclude_slash_tmp',
		displayName: 'Config: Exclude /tmp From Workspace Sandbox',
		description: 'Exclude /tmp from writable roots in workspace-write mode.',
	},
	{
		optionName: 'sandboxWorkspaceWriteExcludeTmpdirEnvVar',
		configKey: 'sandbox_workspace_write.exclude_tmpdir_env_var',
		displayName: 'Config: Exclude TMPDIR From Workspace Sandbox',
		description:
			'Exclude the TMPDIR environment directory from writable roots in workspace-write mode.',
	},
	{
		optionName: 'shellEnvironmentExperimentalUseProfile',
		configKey: 'shell_environment_policy.experimental_use_profile',
		displayName: 'Config: Shell Env Use Profile',
		description: 'Use the user shell profile when spawning subprocesses.',
	},
	{
		optionName: 'shellEnvironmentIgnoreDefaultExcludes',
		configKey: 'shell_environment_policy.ignore_default_excludes',
		displayName: 'Config: Shell Env Ignore Default Excludes',
		description:
			'Keep variables containing KEY, SECRET, or TOKEN before other filters run.',
	},
	{
		optionName: 'showRawAgentReasoning',
		configKey: 'show_raw_agent_reasoning',
		displayName: 'Config: Show Raw Agent Reasoning',
		description:
			'Surface raw reasoning content when the active model emits it.',
	},
	{
		optionName: 'suppressUnstableFeaturesWarning',
		configKey: 'suppress_unstable_features_warning',
		displayName: 'Config: Suppress Unstable Features Warning',
		description:
			'Suppress warnings about under-development Codex feature flags.',
	},
	{
		optionName: 'toolsViewImage',
		configKey: 'tools.view_image',
		displayName: 'Config: View Image Tool',
		description: 'Enable or disable the local-image attachment tool.',
	},
	{
		optionName: 'tuiAnimations',
		configKey: 'tui.animations',
		displayName: 'Config: TUI Animations',
		description: 'Enable terminal animations in interactive TUI runs.',
	},
	{
		optionName: 'tuiRawOutputMode',
		configKey: 'tui.raw_output_mode',
		displayName: 'Config: TUI Raw Output Mode',
		description:
			'Start the TUI in raw scrollback mode for copy-friendly output.',
	},
	{
		optionName: 'tuiShowTooltips',
		configKey: 'tui.show_tooltips',
		displayName: 'Config: TUI Show Tooltips',
		description: 'Show onboarding tooltips in the TUI welcome screen.',
	},
	{
		optionName: 'tuiVimModeDefault',
		configKey: 'tui.vim_mode_default',
		displayName: 'Config: TUI Vim Mode Default',
		description: 'Start the TUI composer in Vim normal mode.',
	},
	{
		optionName: 'windowsSandboxPrivateDesktop',
		configKey: 'windows.sandbox_private_desktop',
		displayName: 'Config: Windows Sandbox Private Desktop',
		description:
			'Run sandboxed child processes on a private desktop on native Windows.',
	},
] as const;

const ENUM_CONFIG_OVERRIDES = [
	{
		optionName: 'approvalsReviewer',
		configKey: 'approvals_reviewer',
		displayName: 'Config: Approvals Reviewer',
		description:
			'Who reviews eligible approval prompts under interactive approval policies.',
		options: APPROVALS_REVIEWER_OPTIONS,
	},
	{
		optionName: 'forcedLoginMethod',
		configKey: 'forced_login_method',
		displayName: 'Config: Forced Login Method',
		description: 'Restrict Codex to ChatGPT login or API-key login.',
		options: FORCED_LOGIN_METHOD_OPTIONS,
	},
	{
		optionName: 'modelAutoCompactTokenLimitScope',
		configKey: 'model_auto_compact_token_limit_scope',
		displayName: 'Config: Auto Compact Token Limit Scope',
		description:
			'Control whether auto-compaction counts the full context or only body tokens after the carried prefix.',
		options: AUTO_COMPACT_TOKEN_LIMIT_SCOPE_OPTIONS,
	},
	{
		optionName: 'cliAuthCredentialsStore',
		configKey: 'cli_auth_credentials_store',
		displayName: 'Config: CLI Auth Credentials Store',
		description: 'Preferred backend for storing CLI auth credentials.',
		options: AUTH_CREDENTIALS_STORE_OPTIONS,
	},
	{
		optionName: 'fileOpener',
		configKey: 'file_opener',
		displayName: 'Config: File Opener',
		description: 'URI scheme used to open file citations from Codex output.',
		options: FILE_OPENER_OPTIONS,
	},
	{
		optionName: 'historyPersistence',
		configKey: 'history.persistence',
		displayName: 'Config: History Persistence',
		description:
			'Control whether Codex saves session transcripts to history.jsonl.',
		options: HISTORY_PERSISTENCE_OPTIONS,
	},
	{
		optionName: 'mcpOauthCredentialsStore',
		configKey: 'mcp_oauth_credentials_store',
		displayName: 'Config: MCP OAuth Credentials Store',
		description: 'Preferred backend for storing MCP OAuth credentials.',
		options: AUTH_CREDENTIALS_STORE_OPTIONS,
	},
	{
		optionName: 'ossProvider',
		configKey: 'oss_provider',
		displayName: 'Config: OSS Provider',
		description: 'Default local provider used when running with --oss.',
		options: LOCAL_PROVIDER_OPTIONS,
	},
	{
		optionName: 'otelExporter',
		configKey: 'otel.exporter',
		displayName: 'Config: OTEL Exporter',
		description: 'OpenTelemetry log exporter mode.',
		options: OTEL_EXPORTER_OPTIONS,
	},
	{
		optionName: 'otelMetricsExporter',
		configKey: 'otel.metrics_exporter',
		displayName: 'Config: OTEL Metrics Exporter',
		description: 'OpenTelemetry metrics exporter mode.',
		options: OTEL_METRICS_EXPORTER_OPTIONS,
	},
	{
		optionName: 'otelTraceExporter',
		configKey: 'otel.trace_exporter',
		displayName: 'Config: OTEL Trace Exporter',
		description: 'OpenTelemetry trace exporter mode.',
		options: OTEL_EXPORTER_OPTIONS,
	},
	{
		optionName: 'personality',
		configKey: 'personality',
		displayName: 'Config: Personality',
		description: 'Default communication style for supported models.',
		options: PERSONALITY_OPTIONS,
	},
	{
		optionName: 'planModeReasoningEffort',
		configKey: 'plan_mode_reasoning_effort',
		displayName: 'Config: Plan Mode Reasoning Effort',
		description: 'Reasoning effort override used in Plan mode.',
		options: REASONING_EFFORT_OPTIONS,
	},
	{
		optionName: 'shellEnvironmentInherit',
		configKey: 'shell_environment_policy.inherit',
		displayName: 'Config: Shell Environment Inherit',
		description:
			'Baseline environment inheritance when Codex spawns subprocesses.',
		options: SHELL_ENVIRONMENT_INHERIT_OPTIONS,
	},
	{
		optionName: 'tuiAlternateScreen',
		configKey: 'tui.alternate_screen',
		displayName: 'Config: TUI Alternate Screen',
		description: 'Control alternate screen usage for interactive TUI runs.',
		options: TUI_ALTERNATE_SCREEN_OPTIONS,
	},
	{
		optionName: 'tuiNotificationCondition',
		configKey: 'tui.notification_condition',
		displayName: 'Config: TUI Notification Condition',
		description:
			'Control whether TUI notifications require an unfocused terminal.',
		options: TUI_NOTIFICATION_CONDITION_OPTIONS,
	},
	{
		optionName: 'tuiNotificationMethod',
		configKey: 'tui.notification_method',
		displayName: 'Config: TUI Notification Method',
		description: 'Terminal notification delivery method for TUI runs.',
		options: TUI_NOTIFICATION_METHOD_OPTIONS,
	},
	{
		optionName: 'windowsSandbox',
		configKey: 'windows.sandbox',
		displayName: 'Config: Windows Sandbox',
		description: 'Native Windows sandbox mode.',
		options: WINDOWS_SANDBOX_OPTIONS,
	},
] as const;

const NUMBER_CONFIG_OVERRIDES = [
	{
		optionName: 'agentsJobMaxRuntimeSeconds',
		configKey: 'agents.job_max_runtime_seconds',
		displayName: 'Config: Agent Job Max Runtime Seconds',
		description: 'Default per-worker timeout for spawn_agents_on_csv jobs.',
	},
	{
		optionName: 'agentsMaxDepth',
		configKey: 'agents.max_depth',
		displayName: 'Config: Agent Max Depth',
		description: 'Maximum nesting depth allowed for spawned agent threads.',
	},
	{
		optionName: 'agentsMaxThreads',
		configKey: 'agents.max_threads',
		displayName: 'Config: Agent Max Threads',
		description: 'Maximum number of agent threads open concurrently.',
	},
	{
		optionName: 'backgroundTerminalMaxTimeout',
		configKey: 'background_terminal_max_timeout',
		displayName: 'Config: Background Terminal Max Timeout',
		description: 'Maximum background terminal polling window in milliseconds.',
	},
	{
		optionName: 'historyMaxBytes',
		configKey: 'history.max_bytes',
		displayName: 'Config: History Max Bytes',
		description:
			'Maximum history file size in bytes before oldest entries are dropped.',
	},
	{
		optionName: 'mcpOauthCallbackPort',
		configKey: 'mcp_oauth_callback_port',
		displayName: 'Config: MCP OAuth Callback Port',
		description: 'Fixed local callback port used during MCP OAuth login.',
	},
	{
		optionName: 'memoriesMaxRawForConsolidation',
		configKey: 'memories.max_raw_memories_for_consolidation',
		displayName: 'Config: Memories Max Raw For Consolidation',
		description:
			'Maximum recent raw memories retained for global consolidation.',
	},
	{
		optionName: 'memoriesMaxRolloutAgeDays',
		configKey: 'memories.max_rollout_age_days',
		displayName: 'Config: Memories Max Rollout Age Days',
		description: 'Maximum age of threads considered for memory generation.',
	},
	{
		optionName: 'memoriesMaxRolloutsPerStartup',
		configKey: 'memories.max_rollouts_per_startup',
		displayName: 'Config: Memories Max Rollouts Per Startup',
		description: 'Maximum rollout candidates processed per startup pass.',
	},
	{
		optionName: 'memoriesMaxUnusedDays',
		configKey: 'memories.max_unused_days',
		displayName: 'Config: Memories Max Unused Days',
		description:
			'Maximum unused days before a memory is ineligible for consolidation.',
	},
	{
		optionName: 'memoriesMinRateLimitRemainingPercent',
		configKey: 'memories.min_rate_limit_remaining_percent',
		displayName: 'Config: Memories Min Rate Limit Remaining Percent',
		description:
			'Minimum remaining rate-limit percentage required before memory generation starts.',
	},
	{
		optionName: 'memoriesMinRolloutIdleHours',
		configKey: 'memories.min_rollout_idle_hours',
		displayName: 'Config: Memories Min Rollout Idle Hours',
		description:
			'Minimum idle time before a thread is considered for memory generation.',
	},
	{
		optionName: 'modelAutoCompactTokenLimit',
		configKey: 'model_auto_compact_token_limit',
		displayName: 'Config: Model Auto Compact Token Limit',
		description: 'Token threshold that triggers automatic history compaction.',
	},
	{
		optionName: 'modelContextWindow',
		configKey: 'model_context_window',
		displayName: 'Config: Model Context Window',
		description: 'Context window tokens available to the active model.',
	},
	{
		optionName: 'projectDocMaxBytes',
		configKey: 'project_doc_max_bytes',
		displayName: 'Config: Project Doc Max Bytes',
		description:
			'Maximum bytes read from AGENTS.md when building project instructions.',
	},
	{
		optionName: 'toolOutputTokenLimit',
		configKey: 'tool_output_token_limit',
		displayName: 'Config: Tool Output Token Limit',
		description:
			'Token budget for storing individual tool outputs in conversation history.',
	},
] as const;

const STRING_CONFIG_OVERRIDES = [
	{
		optionName: 'autoReviewPolicy',
		configKey: 'auto_review.policy',
		displayName: 'Config: Auto Review Policy',
		description:
			'Local Markdown policy instructions for automatic approval review.',
	},
	{
		optionName: 'chatgptBaseUrl',
		configKey: 'chatgpt_base_url',
		displayName: 'Config: ChatGPT Base URL',
		description: 'Base URL used during the ChatGPT login flow.',
	},
	{
		optionName: 'compactPrompt',
		configKey: 'compact_prompt',
		displayName: 'Config: Compact Prompt',
		description: 'Inline override for the history compaction prompt.',
	},
	{
		optionName: 'commitAttribution',
		configKey: 'commit_attribution',
		displayName: 'Config: Commit Attribution',
		description:
			'Commit co-author trailer used when Codex-generated commits are enabled.',
	},
	{
		optionName: 'defaultPermissions',
		configKey: 'default_permissions',
		displayName: 'Config: Default Permissions',
		description:
			'Name of the default permissions profile to apply to sandboxed tool calls.',
	},
	{
		optionName: 'developerInstructions',
		configKey: 'developer_instructions',
		displayName: 'Config: Developer Instructions',
		description: 'Additional developer instructions injected into the session.',
	},
	{
		optionName: 'experimentalRealtimeStartInstructions',
		configKey: 'experimental_realtime_start_instructions',
		displayName: 'Config: Realtime Start Instructions',
		description: 'Experimental realtime session start instructions.',
	},
	{
		optionName: 'experimentalRealtimeWsBackendPrompt',
		configKey: 'experimental_realtime_ws_backend_prompt',
		displayName: 'Config: Realtime WS Backend Prompt',
		description: 'Experimental realtime websocket backend prompt override.',
	},
	{
		optionName: 'experimentalRealtimeWsBaseUrl',
		configKey: 'experimental_realtime_ws_base_url',
		displayName: 'Config: Realtime WS Base URL',
		description: 'Experimental realtime websocket base URL.',
	},
	{
		optionName: 'experimentalRealtimeWsModel',
		configKey: 'experimental_realtime_ws_model',
		displayName: 'Config: Realtime WS Model',
		description: 'Experimental realtime websocket model override.',
	},
	{
		optionName: 'experimentalRealtimeWsStartupContext',
		configKey: 'experimental_realtime_ws_startup_context',
		displayName: 'Config: Realtime WS Startup Context',
		description: 'Experimental realtime websocket startup context.',
	},
	{
		optionName: 'experimentalThreadConfigEndpoint',
		configKey: 'experimental_thread_config_endpoint',
		displayName: 'Config: Thread Config Endpoint',
		description: 'Experimental endpoint for thread-specific config.',
	},
	{
		optionName: 'experimentalThreadStore',
		configKey: 'experimental_thread_store',
		displayName: 'Config: Thread Store',
		description: 'Experimental thread store identifier.',
	},
	{
		optionName: 'experimentalCompactPromptFile',
		configKey: 'experimental_compact_prompt_file',
		displayName: 'Config: Experimental Compact Prompt File',
		description:
			'Path to a file containing an experimental compaction prompt override.',
	},
	{
		optionName: 'forcedChatgptWorkspaceId',
		configKey: 'forced_chatgpt_workspace_id',
		displayName: 'Config: Forced ChatGPT Workspace ID',
		description: 'Restrict ChatGPT logins to a specific workspace ID.',
	},
	{
		optionName: 'instructions',
		configKey: 'instructions',
		displayName: 'Config: Instructions',
		description:
			'Reserved instructions field. Prefer model instructions or AGENTS.md.',
	},
	{
		optionName: 'logDir',
		configKey: 'log_dir',
		displayName: 'Config: Log Directory',
		description: 'Directory where Codex writes log files.',
	},
	{
		optionName: 'mcpOauthCallbackUrl',
		configKey: 'mcp_oauth_callback_url',
		displayName: 'Config: MCP OAuth Callback URL',
		description: 'Redirect URI override for MCP OAuth login.',
	},
	{
		optionName: 'memoriesConsolidationModel',
		configKey: 'memories.consolidation_model',
		displayName: 'Config: Memories Consolidation Model',
		description: 'Model override for global memory consolidation.',
	},
	{
		optionName: 'memoriesExtractModel',
		configKey: 'memories.extract_model',
		displayName: 'Config: Memories Extract Model',
		description: 'Model override for per-thread memory extraction.',
	},
	{
		optionName: 'modelCatalogJson',
		configKey: 'model_catalog_json',
		displayName: 'Config: Model Catalog JSON',
		description: 'Path to a JSON model catalog loaded at startup.',
	},
	{
		optionName: 'modelOverride',
		configKey: 'model',
		displayName: 'Config: Model',
		description:
			'Config-level model override. Prefer the top-level Model field for normal runs.',
	},
	{
		optionName: 'modelInstructionsFile',
		configKey: 'model_instructions_file',
		displayName: 'Config: Model Instructions File',
		description:
			'Path to model instructions that override built-in instructions.',
	},
	{
		optionName: 'modelProvider',
		configKey: 'model_provider',
		displayName: 'Config: Model Provider',
		description: 'Provider ID from model_providers.',
	},
	{
		optionName: 'openaiBaseUrl',
		configKey: 'openai_base_url',
		displayName: 'Config: OpenAI Base URL',
		description: 'Base URL override for the built-in OpenAI model provider.',
	},
	{
		optionName: 'otelEnvironment',
		configKey: 'otel.environment',
		displayName: 'Config: OTEL Environment',
		description: 'Environment tag applied to OpenTelemetry events.',
	},
	{
		optionName: 'reviewModel',
		configKey: 'review_model',
		displayName: 'Config: Review Model',
		description: 'Model override used by /review.',
	},
	{
		optionName: 'serviceTier',
		configKey: 'service_tier',
		displayName: 'Config: Service Tier',
		description: 'Preferred service tier for new turns.',
	},
	{
		optionName: 'sqliteHome',
		configKey: 'sqlite_home',
		displayName: 'Config: SQLite Home',
		description: 'Directory where Codex stores SQLite-backed state.',
	},
	{
		optionName: 'tuiTheme',
		configKey: 'tui.theme',
		displayName: 'Config: TUI Theme',
		description: 'Syntax-highlighting theme override for TUI runs.',
	},
	{
		optionName: 'zshPath',
		configKey: 'zsh_path',
		displayName: 'Config: Zsh Path',
		description: 'Absolute path to patched zsh used by zsh exec bridge.',
	},
] as const;

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

interface CodexProcessResult {
	stdout: string;
	stderr: string;
	exitCode: number | null;
	signal: string | null;
	timedOut: boolean;
	processError: IDataObject | null;
}

class CodexProcessError extends Error {
	result: CodexProcessResult;

	constructor(message: string, result: CodexProcessResult) {
		super(message);
		this.name = 'CodexProcessError';
		this.result = result;
	}
}

interface FixedCollectionField {
	displayName: string;
	name: string;
	placeholder?: string;
	type?: INodeProperties['type'];
	default?: INodeProperties['default'];
	options?: INodePropertyOptions[];
	description?: string;
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
					type: 'string',
					default: '',
					...field,
				})),
			},
		],
		...(config.description ? { description: config.description } : {}),
	};
}

function configBooleanProperty(config: {
	displayName: string;
	name: string;
	description: string;
}): INodeProperties {
	return optionProperty(
		config.displayName,
		config.name,
		CONFIG_BOOLEAN_OPTIONS,
		'default',
		config.description,
	);
}

function configNumberProperty(config: {
	displayName: string;
	name: string;
	description: string;
}): INodeProperties {
	return {
		displayName: config.displayName,
		name: config.name,
		type: 'number',
		default: '',
		description: config.description,
	};
}

const ADDITIONAL_OPTION_PROPERTIES: INodeProperties[] = [
	fixedCollectionProperty({
		displayName: 'Add Directories',
		name: 'addDirs',
		placeholder: 'Add Directory',
		itemName: 'directory',
		itemDisplayName: 'Directory',
		fields: [
			{ displayName: 'Path', name: 'path', placeholder: '/data/shared' },
		],
		description:
			'Additional writable directories passed with repeated --add-dir flags',
	}),
	stringProperty(
		'Codex Binary Path',
		'codexBinaryPath',
		'Path to the codex executable',
		{
			default: 'codex',
		},
	),
	...BOOLEAN_CONFIG_OVERRIDES.map((config) =>
		configBooleanProperty({
			displayName: config.displayName,
			name: config.optionName,
			description: `${config.description} Config key: ${config.configKey}.`,
		}),
	),
	...ENUM_CONFIG_OVERRIDES.map((config) =>
		optionProperty(
			config.displayName,
			config.optionName,
			config.options,
			'default',
			`${config.description} Config key: ${config.configKey}.`,
		),
	),
	...NUMBER_CONFIG_OVERRIDES.map((config) =>
		configNumberProperty({
			displayName: config.displayName,
			name: config.optionName,
			description: `${config.description} Config key: ${config.configKey}.`,
		}),
	),
	...STRING_CONFIG_OVERRIDES.map((config) =>
		stringProperty(
			config.displayName,
			config.optionName,
			`${config.description} Config key: ${config.configKey}.`,
		),
	),
	fixedCollectionProperty({
		displayName: 'Feature Flags',
		name: 'featureFlags',
		placeholder: 'Add Feature Flag',
		itemName: 'feature',
		itemDisplayName: 'Feature Flag',
		fields: [
			{
				displayName: 'Feature',
				name: 'name',
				type: 'options',
				default: '',
				options: [...FEATURE_FLAG_OPTIONS],
				description: 'Codex feature flag to set for this run.',
			},
			{
				displayName: 'State',
				name: 'state',
				type: 'options',
				default: 'default',
				options: [...FEATURE_FLAG_STATE_OPTIONS],
				description: 'Whether to enable or disable the feature for this run.',
			},
		],
		description:
			'Graphical feature flag overrides passed as -c features.<name>=true or false.',
	}),
	fixedCollectionProperty({
		displayName: 'MCP Server Enablement',
		name: 'mcpServerEnablement',
		placeholder: 'Add MCP Server',
		itemName: 'server',
		itemDisplayName: 'MCP Server',
		fields: [
			{
				displayName: 'Server ID',
				name: 'id',
				placeholder: 'notebooklm',
				description: 'Configured MCP server ID from mcp_servers.<id>.',
			},
			{
				displayName: 'Enabled',
				name: 'enabled',
				type: 'options',
				default: 'default',
				options: [...FEATURE_FLAG_STATE_OPTIONS],
				description: 'Enable or disable this configured MCP server.',
			},
		],
		description: 'Graphical overrides for mcp_servers.<id>.enabled.',
	}),
	fixedCollectionProperty({
		displayName: 'Plugin MCP Server Enablement',
		name: 'pluginMcpServerEnablement',
		placeholder: 'Add Plugin MCP Server',
		itemName: 'server',
		itemDisplayName: 'Plugin MCP Server',
		fields: [
			{
				displayName: 'Plugin ID',
				name: 'pluginId',
				placeholder: 'computer-use@openai-bundled',
				description: 'Configured plugin ID from plugins.<plugin>.',
			},
			{
				displayName: 'MCP Server ID',
				name: 'serverId',
				placeholder: 'computer-use',
				description: 'MCP server ID bundled by the plugin.',
			},
			{
				displayName: 'Enabled',
				name: 'enabled',
				type: 'options',
				default: 'default',
				options: [...FEATURE_FLAG_STATE_OPTIONS],
				description: 'Enable or disable this plugin-provided MCP server.',
			},
		],
		description:
			'Graphical overrides for plugins.<plugin>.mcp_servers.<server>.enabled.',
	}),
	fixedCollectionProperty({
		displayName: 'App Defaults',
		name: 'appDefaults',
		placeholder: 'Add App Default',
		itemName: 'app',
		itemDisplayName: 'App Default',
		fields: [
			{
				displayName: 'App ID',
				name: 'id',
				placeholder: 'github',
				description: 'App or connector ID from apps.<id>.',
			},
			{
				displayName: 'Enabled',
				name: 'enabled',
				type: 'options',
				default: 'default',
				options: [...FEATURE_FLAG_STATE_OPTIONS],
				description: 'Enable or disable this app.',
			},
			{
				displayName: 'Destructive Tools',
				name: 'destructiveEnabled',
				type: 'options',
				default: 'default',
				options: [...FEATURE_FLAG_STATE_OPTIONS],
				description:
					'Allow or block tools in this app that advertise destructive behavior.',
			},
			{
				displayName: 'Open World Tools',
				name: 'openWorldEnabled',
				type: 'options',
				default: 'default',
				options: [...FEATURE_FLAG_STATE_OPTIONS],
				description:
					'Allow or block tools in this app that advertise open-world behavior.',
			},
			{
				displayName: 'Default Tools Enabled',
				name: 'defaultToolsEnabled',
				type: 'options',
				default: 'default',
				options: [...FEATURE_FLAG_STATE_OPTIONS],
				description: 'Default enabled state for tools in this app.',
			},
			{
				displayName: 'Default Tools Approval Mode',
				name: 'defaultToolsApprovalMode',
				type: 'options',
				default: 'default',
				options: [...CONFIG_APPROVAL_MODE_OPTIONS],
				description:
					'Default approval behavior for tools in this app unless a per-tool override exists.',
			},
		],
		description:
			'Graphical overrides for apps.<id> app and default tool settings.',
	}),
	fixedCollectionProperty({
		displayName: 'App Tool Overrides',
		name: 'appToolOverrides',
		placeholder: 'Add App Tool',
		itemName: 'tool',
		itemDisplayName: 'App Tool',
		fields: [
			{ displayName: 'App ID', name: 'appId', placeholder: 'github' },
			{
				displayName: 'Tool ID',
				name: 'toolId',
				placeholder: 'repos/list',
				description: 'Tool name under apps.<id>.tools.<tool>.',
			},
			{
				displayName: 'Enabled',
				name: 'enabled',
				type: 'options',
				default: 'default',
				options: [...FEATURE_FLAG_STATE_OPTIONS],
				description: 'Enable or disable this app tool.',
			},
			{
				displayName: 'Approval Mode',
				name: 'approvalMode',
				type: 'options',
				default: 'default',
				options: [...CONFIG_APPROVAL_MODE_OPTIONS],
				description: 'Approval behavior override for this app tool.',
			},
		],
		description: 'Graphical overrides for apps.<id>.tools.<tool>.',
	}),
	fixedCollectionProperty({
		displayName: 'MCP Server Config',
		name: 'mcpServerConfig',
		placeholder: 'Add MCP Server Config',
		itemName: 'server',
		itemDisplayName: 'MCP Server Config',
		fields: [
			{ displayName: 'Server ID', name: 'id', placeholder: 'notebooklm' },
			{
				displayName: 'Command',
				name: 'command',
				description: 'Launcher command for an MCP stdio server.',
			},
			{
				displayName: 'Arguments',
				name: 'args',
				description:
					'Comma-separated arguments passed to the MCP stdio server command.',
			},
			{
				displayName: 'Working Directory',
				name: 'cwd',
				description: 'Working directory for the MCP stdio server process.',
			},
			{
				displayName: 'URL',
				name: 'url',
				description: 'Endpoint for an MCP streamable HTTP server.',
			},
			{
				displayName: 'Bearer Token Env Var',
				name: 'bearerTokenEnvVar',
				description:
					'Environment variable sourcing the bearer token for an MCP HTTP server.',
			},
			{
				displayName: 'Enabled',
				name: 'enabled',
				type: 'options',
				default: 'default',
				options: [...FEATURE_FLAG_STATE_OPTIONS],
				description: 'Enable or disable this MCP server.',
			},
			{
				displayName: 'Required',
				name: 'required',
				type: 'options',
				default: 'default',
				options: [...FEATURE_FLAG_STATE_OPTIONS],
				description:
					'Fail startup or resume if this enabled MCP server cannot initialize.',
			},
			{
				displayName: 'Startup Timeout Seconds',
				name: 'startupTimeoutSec',
				type: 'number',
				default: '',
				description:
					'Override the default startup timeout for this MCP server.',
			},
			{
				displayName: 'Startup Timeout Milliseconds',
				name: 'startupTimeoutMs',
				type: 'number',
				default: '',
				description: 'Millisecond alias for startup timeout.',
			},
			{
				displayName: 'Tool Timeout Seconds',
				name: 'toolTimeoutSec',
				type: 'number',
				default: '',
				description:
					'Override the default per-tool timeout for this MCP server.',
			},
			{
				displayName: 'Enabled Tools',
				name: 'enabledTools',
				description:
					'Comma-separated allow list of tool names exposed by the MCP server.',
			},
			{
				displayName: 'Disabled Tools',
				name: 'disabledTools',
				description: 'Comma-separated deny list applied after Enabled Tools.',
			},
			{
				displayName: 'Default Tools Approval Mode',
				name: 'defaultToolsApprovalMode',
				type: 'options',
				default: 'default',
				options: [...CONFIG_APPROVAL_MODE_OPTIONS],
				description: 'Default approval behavior for MCP tools on this server.',
			},
			{
				displayName: 'OAuth Scopes',
				name: 'scopes',
				description:
					'Comma-separated OAuth scopes requested when authenticating this MCP server.',
			},
			{
				displayName: 'OAuth Resource',
				name: 'oauthResource',
				description: 'Optional RFC 8707 OAuth resource parameter.',
			},
			{
				displayName: 'Experimental Environment',
				name: 'experimentalEnvironment',
				type: 'options',
				default: 'default',
				options: [...MCP_ENVIRONMENT_OPTIONS],
				description: 'Experimental MCP server placement.',
			},
		],
		description:
			'Graphical overrides for mcp_servers.<id> command, HTTP, timeout, tool, OAuth, and placement settings.',
	}),
	fixedCollectionProperty({
		displayName: 'MCP Server Environment',
		name: 'mcpServerEnvironment',
		placeholder: 'Add MCP Environment Variable',
		itemName: 'env',
		itemDisplayName: 'MCP Environment Variable',
		fields: [
			{ displayName: 'Server ID', name: 'serverId', placeholder: 'notebooklm' },
			{ displayName: 'Name', name: 'name', placeholder: 'API_KEY' },
			{ displayName: 'Value', name: 'value' },
		],
		description: 'Graphical overrides for mcp_servers.<id>.env.<name> values.',
	}),
	fixedCollectionProperty({
		displayName: 'MCP Server HTTP Headers',
		name: 'mcpServerHttpHeaders',
		placeholder: 'Add MCP Header',
		itemName: 'header',
		itemDisplayName: 'MCP Header',
		fields: [
			{ displayName: 'Server ID', name: 'serverId', placeholder: 'notebooklm' },
			{ displayName: 'Header Name', name: 'name', placeholder: 'X-API-Key' },
			{ displayName: 'Value', name: 'value' },
			{
				displayName: 'Value Source',
				name: 'source',
				type: 'options',
				default: 'static',
				options: [
					{ name: 'Static Value', value: 'static' },
					{ name: 'Environment Variable', value: 'env' },
				],
				description:
					'Static writes http_headers; Environment Variable writes env_http_headers.',
			},
		],
		description:
			'Graphical overrides for static and environment-sourced MCP HTTP headers.',
	}),
	fixedCollectionProperty({
		displayName: 'MCP Tool Approval',
		name: 'mcpToolApproval',
		placeholder: 'Add MCP Tool Approval',
		itemName: 'tool',
		itemDisplayName: 'MCP Tool Approval',
		fields: [
			{ displayName: 'Server ID', name: 'serverId', placeholder: 'notebooklm' },
			{ displayName: 'Tool Name', name: 'toolName' },
			{
				displayName: 'Approval Mode',
				name: 'approvalMode',
				type: 'options',
				default: 'default',
				options: [...CONFIG_APPROVAL_MODE_OPTIONS],
			},
		],
		description:
			'Graphical overrides for mcp_servers.<id>.tools.<tool>.approval_mode.',
	}),
	fixedCollectionProperty({
		displayName: 'Plugin MCP Server Tools',
		name: 'pluginMcpServerTools',
		placeholder: 'Add Plugin MCP Tools',
		itemName: 'server',
		itemDisplayName: 'Plugin MCP Tools',
		fields: [
			{
				displayName: 'Plugin ID',
				name: 'pluginId',
				placeholder: 'computer-use@openai-bundled',
			},
			{ displayName: 'MCP Server ID', name: 'serverId' },
			{
				displayName: 'Enabled Tools',
				name: 'enabledTools',
				description:
					'Comma-separated allow list of tools exposed by this server.',
			},
			{
				displayName: 'Disabled Tools',
				name: 'disabledTools',
				description: 'Comma-separated deny list applied after Enabled Tools.',
			},
			{
				displayName: 'Default Tools Approval Mode',
				name: 'defaultToolsApprovalMode',
				type: 'options',
				default: 'default',
				options: [...CONFIG_APPROVAL_MODE_OPTIONS],
			},
		],
		description:
			'Graphical overrides for plugin-provided MCP server tool lists and default approval mode.',
	}),
	fixedCollectionProperty({
		displayName: 'Plugin MCP Tool Approval',
		name: 'pluginMcpToolApproval',
		placeholder: 'Add Plugin MCP Tool Approval',
		itemName: 'tool',
		itemDisplayName: 'Plugin MCP Tool Approval',
		fields: [
			{
				displayName: 'Plugin ID',
				name: 'pluginId',
				placeholder: 'computer-use@openai-bundled',
			},
			{ displayName: 'MCP Server ID', name: 'serverId' },
			{ displayName: 'Tool Name', name: 'toolName' },
			{
				displayName: 'Approval Mode',
				name: 'approvalMode',
				type: 'options',
				default: 'default',
				options: [...CONFIG_APPROVAL_MODE_OPTIONS],
			},
		],
		description:
			'Graphical overrides for plugins.<plugin>.mcp_servers.<server>.tools.<tool>.approval_mode.',
	}),
	fixedCollectionProperty({
		displayName: 'Shell Environment Lists',
		name: 'shellEnvironmentLists',
		placeholder: 'Add Shell Environment List',
		itemName: 'list',
		itemDisplayName: 'Shell Environment List',
		fields: [
			{
				displayName: 'List',
				name: 'listName',
				type: 'options',
				default: 'exclude',
				options: [
					{ name: 'Exclude', value: 'exclude' },
					{ name: 'Include Only', value: 'include_only' },
				],
			},
			{
				displayName: 'Patterns',
				name: 'patterns',
				description: 'Comma-separated environment variable glob patterns.',
			},
		],
		description:
			'Graphical overrides for shell_environment_policy.exclude and include_only.',
	}),
	fixedCollectionProperty({
		displayName: 'Shell Environment Set',
		name: 'shellEnvironmentSet',
		placeholder: 'Add Shell Environment Value',
		itemName: 'env',
		itemDisplayName: 'Shell Environment Value',
		fields: [
			{ displayName: 'Name', name: 'name', placeholder: 'NODE_ENV' },
			{ displayName: 'Value', name: 'value' },
		],
		description: 'Graphical overrides for shell_environment_policy.set.',
	}),
	fixedCollectionProperty({
		displayName: 'Config String Lists',
		name: 'configStringLists',
		placeholder: 'Add Config String List',
		itemName: 'list',
		itemDisplayName: 'Config String List',
		fields: [
			{
				displayName: 'Config Key',
				name: 'configKey',
				type: 'options',
				default: 'notify',
				options: [
					{ name: 'Notify Command', value: 'notify' },
					{
						name: 'Project Doc Fallback Filenames',
						value: 'project_doc_fallback_filenames',
					},
					{ name: 'Project Root Markers', value: 'project_root_markers' },
					{ name: 'TUI Notifications', value: 'tui.notifications' },
					{ name: 'TUI Status Line', value: 'tui.status_line' },
					{ name: 'TUI Terminal Title', value: 'tui.terminal_title' },
				],
				description: 'String-list config key to set.',
			},
			{
				displayName: 'Values',
				name: 'values',
				description: 'Comma-separated string values for the selected key.',
			},
		],
		description:
			'Graphical overrides for documented array<string> config keys.',
	}),
	fixedCollectionProperty({
		displayName: 'Agent Roles',
		name: 'agentRoles',
		placeholder: 'Add Agent Role',
		itemName: 'role',
		itemDisplayName: 'Agent Role',
		fields: [
			{ displayName: 'Role Name', name: 'name' },
			{
				displayName: 'Description',
				name: 'description',
				description: 'Role guidance shown when Codex chooses this agent type.',
			},
			{
				displayName: 'Config File',
				name: 'configFile',
				description: 'Path to a TOML config layer for that role.',
			},
			{
				displayName: 'Nickname Candidates',
				name: 'nicknameCandidates',
				description: 'Comma-separated display nicknames for spawned agents.',
			},
		],
		description:
			'Graphical overrides for agents.<name>.description, config_file, and nickname_candidates.',
	}),
	fixedCollectionProperty({
		displayName: 'Skills Config',
		name: 'skillsConfig',
		placeholder: 'Add Skill Config',
		itemName: 'skill',
		itemDisplayName: 'Skill Config',
		fields: [
			{
				displayName: 'Path',
				name: 'path',
				description: 'Path to a skill folder containing SKILL.md.',
			},
			{
				displayName: 'Enabled',
				name: 'enabled',
				type: 'options',
				default: 'default',
				options: [...FEATURE_FLAG_STATE_OPTIONS],
				description: 'Enable or disable the referenced skill.',
			},
		],
		description: 'Graphical entries for skills.config.',
	}),
	fixedCollectionProperty({
		displayName: 'Project Trust',
		name: 'projectTrust',
		placeholder: 'Add Project Trust',
		itemName: 'project',
		itemDisplayName: 'Project Trust',
		fields: [
			{ displayName: 'Path', name: 'path', placeholder: '/data/project' },
			{
				displayName: 'Trust Level',
				name: 'trustLevel',
				type: 'options',
				default: 'default',
				options: [...PROJECT_TRUST_LEVEL_OPTIONS],
				description:
					'Trusted loads project-scoped .codex layers; untrusted skips them.',
			},
		],
		description: 'Graphical overrides for projects.<path>.trust_level.',
	}),
	fixedCollectionProperty({
		displayName: 'Profile Config Overrides',
		name: 'profileConfigOverrides',
		placeholder: 'Add Profile Override',
		itemName: 'override',
		itemDisplayName: 'Profile Override',
		fields: [
			{ displayName: 'Profile Name', name: 'profileName' },
			{
				displayName: 'Config Key',
				name: 'configKey',
				placeholder: 'web_search',
				description: 'Config key inside profiles.<name>.',
			},
			{
				displayName: 'Value',
				name: 'value',
				placeholder: '"disabled"',
				description: 'TOML value for the profile-scoped override.',
			},
		],
		description:
			'Graphical scoped escape hatch for profiles.<name>.* overrides.',
	}),
	fixedCollectionProperty({
		displayName: 'Permission Filesystem Rules',
		name: 'permissionFilesystemRules',
		placeholder: 'Add Filesystem Rule',
		itemName: 'rule',
		itemDisplayName: 'Filesystem Rule',
		fields: [
			{ displayName: 'Permission Profile', name: 'profileName' },
			{
				displayName: 'Path Or Glob',
				name: 'path',
				placeholder: '/data/project/.env',
			},
			{
				displayName: 'Access',
				name: 'access',
				type: 'options',
				default: 'read',
				options: [
					{ name: 'Read', value: 'read' },
					{ name: 'Write', value: 'write' },
					{ name: 'Deny', value: 'deny' },
				],
			},
		],
		description:
			'Graphical overrides for permissions.<name>.filesystem.<path-or-glob>.',
	}),
	fixedCollectionProperty({
		displayName: 'Permission Network',
		name: 'permissionNetwork',
		placeholder: 'Add Permission Network',
		itemName: 'network',
		itemDisplayName: 'Permission Network',
		fields: [
			{ displayName: 'Permission Profile', name: 'profileName' },
			{
				displayName: 'Enabled',
				name: 'enabled',
				type: 'options',
				default: 'default',
				options: [...FEATURE_FLAG_STATE_OPTIONS],
			},
			{
				displayName: 'Mode',
				name: 'mode',
				type: 'options',
				default: 'default',
				options: [
					{ name: 'Use Codex Default', value: 'default' },
					{ name: 'Limited', value: 'limited' },
					{ name: 'Full', value: 'full' },
				],
			},
			{ displayName: 'Proxy URL', name: 'proxyUrl' },
			{
				displayName: 'Enable SOCKS5',
				name: 'enableSocks5',
				type: 'options',
				default: 'default',
				options: [...FEATURE_FLAG_STATE_OPTIONS],
			},
			{ displayName: 'SOCKS URL', name: 'socksUrl' },
			{
				displayName: 'Enable SOCKS5 UDP',
				name: 'enableSocks5Udp',
				type: 'options',
				default: 'default',
				options: [...FEATURE_FLAG_STATE_OPTIONS],
			},
			{
				displayName: 'Allow Upstream Proxy',
				name: 'allowUpstreamProxy',
				type: 'options',
				default: 'default',
				options: [...FEATURE_FLAG_STATE_OPTIONS],
			},
			{
				displayName: 'Allow Local Binding',
				name: 'allowLocalBinding',
				type: 'options',
				default: 'default',
				options: [...FEATURE_FLAG_STATE_OPTIONS],
			},
			{
				displayName: 'Allow Non-Loopback Proxy',
				name: 'dangerouslyAllowNonLoopbackProxy',
				type: 'options',
				default: 'default',
				options: [...FEATURE_FLAG_STATE_OPTIONS],
			},
			{
				displayName: 'Allow All Unix Sockets',
				name: 'dangerouslyAllowAllUnixSockets',
				type: 'options',
				default: 'default',
				options: [...FEATURE_FLAG_STATE_OPTIONS],
			},
		],
		description: 'Graphical overrides for permissions.<name>.network settings.',
	}),
	fixedCollectionProperty({
		displayName: 'Permission Network Domains',
		name: 'permissionNetworkDomains',
		placeholder: 'Add Network Domain',
		itemName: 'domain',
		itemDisplayName: 'Network Domain',
		fields: [
			{ displayName: 'Permission Profile', name: 'profileName' },
			{
				displayName: 'Domain Pattern',
				name: 'pattern',
				placeholder: '**.example.com',
			},
			{
				displayName: 'Decision',
				name: 'decision',
				type: 'options',
				default: 'allow',
				options: [
					{ name: 'Allow', value: 'allow' },
					{ name: 'Deny', value: 'deny' },
				],
			},
		],
		description:
			'Graphical overrides for permissions.<name>.network.domains.<pattern>.',
	}),
	fixedCollectionProperty({
		displayName: 'OTEL Exporter Settings',
		name: 'otelExporterSettings',
		placeholder: 'Add OTEL Exporter',
		itemName: 'exporter',
		itemDisplayName: 'OTEL Exporter',
		fields: [
			{
				displayName: 'Exporter Type',
				name: 'exporterType',
				type: 'options',
				default: 'exporter',
				options: [
					{ name: 'Logs', value: 'exporter' },
					{ name: 'Traces', value: 'trace_exporter' },
				],
			},
			{ displayName: 'Exporter ID', name: 'id', placeholder: 'otlp' },
			{ displayName: 'Endpoint', name: 'endpoint' },
			{
				displayName: 'Protocol',
				name: 'protocol',
				type: 'options',
				default: 'default',
				options: [...OTEL_PROTOCOL_OPTIONS],
			},
			{ displayName: 'CA Certificate', name: 'caCertificate' },
			{ displayName: 'Client Certificate', name: 'clientCertificate' },
			{ displayName: 'Client Private Key', name: 'clientPrivateKey' },
		],
		description:
			'Graphical overrides for otel exporter endpoints, protocols, and TLS paths.',
	}),
	fixedCollectionProperty({
		displayName: 'OTEL Exporter Headers',
		name: 'otelExporterHeaders',
		placeholder: 'Add OTEL Header',
		itemName: 'header',
		itemDisplayName: 'OTEL Header',
		fields: [
			{
				displayName: 'Exporter Type',
				name: 'exporterType',
				type: 'options',
				default: 'exporter',
				options: [
					{ name: 'Logs', value: 'exporter' },
					{ name: 'Traces', value: 'trace_exporter' },
				],
			},
			{ displayName: 'Exporter ID', name: 'id', placeholder: 'otlp' },
			{ displayName: 'Header Name', name: 'name' },
			{ displayName: 'Value', name: 'value' },
		],
		description: 'Graphical overrides for otel exporter headers.',
	}),
	fixedCollectionProperty({
		displayName: 'Documented Advanced Config Overrides',
		name: 'documentedConfigOverrides',
		placeholder: 'Add Documented Override',
		itemName: 'override',
		itemDisplayName: 'Documented Override',
		fields: [
			{
				displayName: 'Documented Pattern',
				name: 'pattern',
				type: 'options',
				default: 'hooks',
				options: [...DOCUMENTED_ADVANCED_CONFIG_OPTIONS],
				description:
					'Pick the documented config family for the tooltip and expected value shape.',
			},
			{
				displayName: 'Resolved Config Key',
				name: 'key',
				placeholder: 'tools.web_search',
				description:
					'Exact config key to pass after replacing placeholders such as <id> or <name>.',
			},
			{
				displayName: 'TOML Value',
				name: 'value',
				placeholder: '{ context_size = "low" }',
				description:
					'TOML value for the resolved key. Strings need TOML quotes.',
			},
		],
		description:
			'Described UI path for documented complex config patterns that require TOML table, map, or array values.',
	}),
	fixedCollectionProperty({
		displayName: 'Raw Config Overrides',
		name: 'configOverrides',
		placeholder: 'Add Override',
		itemName: 'override',
		itemDisplayName: 'Override',
		fields: [
			{
				displayName: 'Key',
				name: 'key',
				placeholder: 'model_reasoning_effort',
			},
			{ displayName: 'Value', name: 'value', placeholder: '"high"' },
		],
		description:
			'Advanced escape hatch for additional -c key=value overrides. String values must include TOML quotes.',
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
	booleanProperty(
		'Ephemeral',
		'ephemeral',
		'Whether to run without persisting session files',
	),
	booleanProperty(
		'Ignore Project Rules',
		'ignoreRules',
		'Whether to add --ignore-rules',
	),
	booleanProperty(
		'Ignore User Config',
		'ignoreUserConfig',
		'Whether to add --ignore-user-config. Requires Skip Git Repo Check.',
	),
	fixedCollectionProperty({
		displayName: 'Images',
		name: 'images',
		placeholder: 'Add Image',
		itemName: 'image',
		itemDisplayName: 'Image',
		fields: [
			{ displayName: 'Path', name: 'path', placeholder: '/data/image.png' },
		],
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
		description:
			'JSON Schema content. The node writes it to a temporary file and passes --output-schema.',
	},
	stringProperty(
		'Output Schema File',
		'outputSchemaFile',
		'Existing JSON Schema file passed to --output-schema',
	),
	stringProperty(
		'Profile',
		'profile',
		'Configuration profile from config.toml',
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
		'Whether to allow running Codex outside a Git repository. Required when Ignore User Config is enabled.',
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
			stringProperty(
				'Prompt',
				'prompt',
				'Prompt sent to Codex as the instruction argument',
				{
					required: true,
					typeOptions: {
						rows: 6,
					},
				},
			),
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
					const streams = codexProcessStreams(error);
					returnData.push({
						json: {
							error: (error as Error).message,
							stdout: streams.stdout,
							stderr: streams.stderr,
						},
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
	const outputFormat = this.getNodeParameter(
		'outputFormat',
		itemIndex,
	) as OutputFormat;
	const model = this.getNodeParameter('model', itemIndex, '') as ModelSelection;
	const customModel = this.getNodeParameter(
		'customModel',
		itemIndex,
		'',
	) as string;
	const workingDirectory = this.getNodeParameter(
		'workingDirectory',
		itemIndex,
		'',
	) as string;
	const resumeMode = this.getNodeParameter(
		'resumeMode',
		itemIndex,
	) as ResumeMode;
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

	validateAdditionalOptions(additionalOptions);

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
	const timeoutMs =
		(((additionalOptions.timeout as number) || 600) as number) * 1000;

	const env = buildCodexEnvironment(additionalOptions);
	const cwd = workingDirectory.trim() || undefined;
	let processResult: CodexProcessResult;
	let processErrorMessage: string | undefined;
	try {
		processResult = await spawnCodex(codexBinaryPath, args, cwd, env, timeoutMs);
	} catch (error) {
		if (!(error instanceof CodexProcessError)) {
			throw error;
		}
		processResult = error.result;
		processErrorMessage = error.message;
	} finally {
		await preparedSchemaFile.cleanup();
	}

	if (processErrorMessage !== undefined) {
		return codexProcessOutput(outputFormat, processResult, processErrorMessage);
	}

	return codexProcessOutput(outputFormat, processResult);
}

function codexProcessOutput(
	outputFormat: OutputFormat,
	processResult: CodexProcessResult,
	errorMessage?: string,
): IDataObject {
	const { stdout, stderr, exitCode, signal, timedOut, processError } =
		processResult;
	const processFields = {
		stdout,
		stderr,
		exitCode,
		signal,
		timedOut,
		processError,
	};

	if (outputFormat === 'text') {
		return {
			text: stdout.replace(/\s+$/, ''),
			...(errorMessage === undefined ? {} : { error: errorMessage }),
			...processFields,
		};
	}

	if (errorMessage !== undefined) {
		return {
			error: errorMessage,
			...processFields,
		};
	}

	const events = parseJsonLines(stdout);

	if (outputFormat === 'json') {
		return {
			events: events as unknown as IDataObject[],
			...processFields,
		};
	}

	const summary = summarizeEvents(events);
	return {
		...(summary as unknown as IDataObject),
		...processFields,
	};
}

function codexProcessStreams(error: unknown): CodexProcessResult {
	if (error instanceof CodexProcessError) {
		return error.result;
	}

	return {
		stdout: '',
		stderr: '',
		exitCode: null,
		signal: null,
		timedOut: false,
		processError: null,
	};
}

function validateAdditionalOptions(additionalOptions: IDataObject): void {
	if (
		additionalOptions.ignoreUserConfig === true &&
		additionalOptions.skipGitRepoCheck !== true
	) {
		throw new Error(
			'Ignore User Config requires Skip Git Repo Check because Codex cannot load directory trust when user config is ignored. Enable Skip Git Repo Check or disable Ignore User Config.',
		);
	}
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
	const {
		outputFormat,
		model,
		approvalPolicy,
		additionalOptions,
		outputSchemaFile,
	} = options;

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

	appendRepeated(
		args,
		'--image',
		collectionStrings(additionalOptions.images, 'image', 'path'),
	);

	if (model) args.push('--model', model);

	if (additionalOptions.skipGitRepoCheck === true)
		args.push('--skip-git-repo-check');
	if (additionalOptions.ephemeral === true) args.push('--ephemeral');
	if (additionalOptions.ignoreUserConfig === true)
		args.push('--ignore-user-config');
	if (additionalOptions.ignoreRules === true) args.push('--ignore-rules');
	if (outputSchemaFile) args.push('--output-schema', outputSchemaFile);
	if (outputFormat !== 'text') args.push('--json');

	const outputLastMessageFile = stringOption(
		additionalOptions.outputLastMessageFile,
	);
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
	const overrides = createConfigOverrideAccumulator();

	for (const override of configOverrideValues(
		additionalOptions.configOverrides,
	)) {
		addRawConfigOverride(overrides, override);
	}

	if (approvalPolicy !== 'default') {
		addStringConfigOverride(overrides, 'approval_policy', approvalPolicy);
	}

	const reasoningEffort = enumOption<ReasoningEffort>(
		additionalOptions.reasoningEffort,
		'default',
	);
	if (reasoningEffort !== 'default') {
		addStringConfigOverride(
			overrides,
			'model_reasoning_effort',
			reasoningEffort,
		);
	}

	const reasoningSummary = enumOption<ReasoningSummary>(
		additionalOptions.reasoningSummary,
		'default',
	);
	if (reasoningSummary !== 'default') {
		addStringConfigOverride(
			overrides,
			'model_reasoning_summary',
			reasoningSummary,
		);
	}

	const verbosity = enumOption<ModelVerbosity>(
		additionalOptions.verbosity,
		'default',
	);
	if (verbosity !== 'default') {
		addStringConfigOverride(overrides, 'model_verbosity', verbosity);
	}

	const webSearch = enumOption<WebSearchMode>(
		additionalOptions.webSearch,
		'default',
	);
	if (webSearch !== 'default') {
		addStringConfigOverride(overrides, 'web_search', webSearch);
	}

	if (additionalOptions.networkAccess === true) {
		addConfigOverride(
			overrides,
			'sandbox_workspace_write.network_access',
			'true',
		);
	}

	appendStructuredConfigOverrides(overrides, additionalOptions);

	for (const override of overrides.values) {
		args.push('-c', override);
	}
}

interface ConfigOverrideAccumulator {
	keys: Set<string>;
	values: string[];
}

function createConfigOverrideAccumulator(): ConfigOverrideAccumulator {
	return { keys: new Set<string>(), values: [] };
}

function appendStructuredConfigOverrides(
	overrides: ConfigOverrideAccumulator,
	additionalOptions: IDataObject,
): void {
	for (const config of BOOLEAN_CONFIG_OVERRIDES) {
		appendBooleanConfigOverride(
			overrides,
			additionalOptions,
			config.optionName,
			config.configKey,
		);
	}
	for (const config of ENUM_CONFIG_OVERRIDES) {
		appendEnumConfigOverride(
			overrides,
			additionalOptions,
			config.optionName,
			config.configKey,
		);
	}
	for (const config of NUMBER_CONFIG_OVERRIDES) {
		appendNumberConfigOverride(
			overrides,
			additionalOptions,
			config.optionName,
			config.configKey,
		);
	}
	for (const config of STRING_CONFIG_OVERRIDES) {
		appendOptionalStringConfigOverride(
			overrides,
			additionalOptions,
			config.optionName,
			config.configKey,
		);
	}
	appendFeatureFlagConfigOverrides(overrides, additionalOptions.featureFlags);
	appendMcpServerEnablementOverrides(
		overrides,
		additionalOptions.mcpServerEnablement,
	);
	appendPluginMcpServerEnablementOverrides(
		overrides,
		additionalOptions.pluginMcpServerEnablement,
	);
	appendAppConfigOverrides(overrides, additionalOptions.appDefaults);
	appendAppToolOverrides(overrides, additionalOptions.appToolOverrides);
	appendMcpServerConfigOverrides(overrides, additionalOptions.mcpServerConfig);
	appendMcpServerEnvironmentOverrides(
		overrides,
		additionalOptions.mcpServerEnvironment,
	);
	appendMcpServerHttpHeaderOverrides(
		overrides,
		additionalOptions.mcpServerHttpHeaders,
	);
	appendMcpToolApprovalOverrides(overrides, additionalOptions.mcpToolApproval);
	appendPluginMcpServerToolOverrides(
		overrides,
		additionalOptions.pluginMcpServerTools,
	);
	appendPluginMcpToolApprovalOverrides(
		overrides,
		additionalOptions.pluginMcpToolApproval,
	);
	appendShellEnvironmentListOverrides(
		overrides,
		additionalOptions.shellEnvironmentLists,
	);
	appendShellEnvironmentSetOverrides(
		overrides,
		additionalOptions.shellEnvironmentSet,
	);
	appendConfigStringListOverrides(
		overrides,
		additionalOptions.configStringLists,
	);
	appendAgentRoleOverrides(overrides, additionalOptions.agentRoles);
	appendSkillsConfigOverrides(overrides, additionalOptions.skillsConfig);
	appendProjectTrustOverrides(overrides, additionalOptions.projectTrust);
	appendProfileConfigOverrides(
		overrides,
		additionalOptions.profileConfigOverrides,
	);
	appendPermissionFilesystemRuleOverrides(
		overrides,
		additionalOptions.permissionFilesystemRules,
	);
	appendPermissionNetworkOverrides(
		overrides,
		additionalOptions.permissionNetwork,
	);
	appendPermissionNetworkDomainOverrides(
		overrides,
		additionalOptions.permissionNetworkDomains,
	);
	appendOtelExporterSettingOverrides(
		overrides,
		additionalOptions.otelExporterSettings,
	);
	appendOtelExporterHeaderOverrides(
		overrides,
		additionalOptions.otelExporterHeaders,
	);
	appendDocumentedConfigOverrides(
		overrides,
		additionalOptions.documentedConfigOverrides,
	);
}

function appendBooleanConfigOverride(
	overrides: ConfigOverrideAccumulator,
	additionalOptions: IDataObject,
	optionName: string,
	configKey: string,
): void {
	const value = stringOption(additionalOptions[optionName]);
	if (!value || value === 'default') return;
	if (value !== 'true' && value !== 'false') {
		throw new Error(
			`${optionName} must be Enabled, Disabled, or Use Codex Default`,
		);
	}
	addConfigOverride(overrides, configKey, value);
}

function appendEnumConfigOverride(
	overrides: ConfigOverrideAccumulator,
	additionalOptions: IDataObject,
	optionName: string,
	configKey: string,
): void {
	const value = stringOption(additionalOptions[optionName]);
	if (!value || value === 'default') return;
	addStringConfigOverride(overrides, configKey, value);
}

function appendNumberConfigOverride(
	overrides: ConfigOverrideAccumulator,
	additionalOptions: IDataObject,
	optionName: string,
	configKey: string,
): void {
	const rawValue = additionalOptions[optionName];
	if (rawValue === undefined || rawValue === null || rawValue === '') return;
	const numericValue =
		typeof rawValue === 'number'
			? rawValue
			: Number.parseFloat(String(rawValue));
	if (!Number.isFinite(numericValue)) {
		throw new Error(`${optionName} must be a finite number`);
	}
	addConfigOverride(overrides, configKey, String(numericValue));
}

function appendOptionalStringConfigOverride(
	overrides: ConfigOverrideAccumulator,
	additionalOptions: IDataObject,
	optionName: string,
	configKey: string,
): void {
	const value = stringOption(additionalOptions[optionName]);
	if (!value) return;
	addStringConfigOverride(overrides, configKey, value);
}

function appendFeatureFlagConfigOverrides(
	overrides: ConfigOverrideAccumulator,
	value: unknown,
): void {
	for (const item of collectionItems(value, 'feature')) {
		const name = stringOption(item.name);
		const state = stringOption(item.state);
		if (!name && (!state || state === 'default')) continue;
		if (!name || !state || state === 'default') {
			throw new Error('Feature Flag rows require both Feature and State');
		}
		if (state !== 'true' && state !== 'false') {
			throw new Error('Feature Flag State must be Enabled or Disabled');
		}
		addConfigOverride(overrides, `features.${name}`, state);
	}
}

function appendMcpServerEnablementOverrides(
	overrides: ConfigOverrideAccumulator,
	value: unknown,
): void {
	for (const item of collectionItems(value, 'server')) {
		const id = stringOption(item.id);
		const enabled = stringOption(item.enabled);
		if (!id && (!enabled || enabled === 'default')) continue;
		if (!id || !enabled || enabled === 'default') {
			throw new Error(
				'MCP Server Enablement rows require Server ID and Enabled',
			);
		}
		if (enabled !== 'true' && enabled !== 'false') {
			throw new Error('MCP Server Enabled must be Enabled or Disabled');
		}
		addConfigOverride(
			overrides,
			dottedConfigKey('mcp_servers', id, 'enabled'),
			enabled,
		);
	}
}

function appendPluginMcpServerEnablementOverrides(
	overrides: ConfigOverrideAccumulator,
	value: unknown,
): void {
	for (const item of collectionItems(value, 'server')) {
		const pluginId = stringOption(item.pluginId);
		const serverId = stringOption(item.serverId);
		const enabled = stringOption(item.enabled);
		if (!pluginId && !serverId && (!enabled || enabled === 'default')) continue;
		if (!pluginId || !serverId || !enabled || enabled === 'default') {
			throw new Error(
				'Plugin MCP Server Enablement rows require Plugin ID, MCP Server ID, and Enabled',
			);
		}
		if (enabled !== 'true' && enabled !== 'false') {
			throw new Error('Plugin MCP Server Enabled must be Enabled or Disabled');
		}
		addConfigOverride(
			overrides,
			dottedConfigKey('plugins', pluginId, 'mcp_servers', serverId, 'enabled'),
			enabled,
		);
	}
}

function appendAppConfigOverrides(
	overrides: ConfigOverrideAccumulator,
	value: unknown,
): void {
	for (const item of collectionItems(value, 'app')) {
		const id = stringOption(item.id);
		if (
			!id &&
			!rowHasValues(item, [
				'enabled',
				'destructiveEnabled',
				'openWorldEnabled',
				'defaultToolsEnabled',
				'defaultToolsApprovalMode',
			])
		) {
			continue;
		}
		if (!id) throw new Error('App Defaults rows require App ID');
		addOptionalBooleanRowOverride(
			overrides,
			dottedConfigKey('apps', id, 'enabled'),
			item.enabled,
			'App Defaults Enabled',
		);
		addOptionalBooleanRowOverride(
			overrides,
			dottedConfigKey('apps', id, 'destructive_enabled'),
			item.destructiveEnabled,
			'App Defaults Destructive Tools',
		);
		addOptionalBooleanRowOverride(
			overrides,
			dottedConfigKey('apps', id, 'open_world_enabled'),
			item.openWorldEnabled,
			'App Defaults Open World Tools',
		);
		addOptionalBooleanRowOverride(
			overrides,
			dottedConfigKey('apps', id, 'default_tools_enabled'),
			item.defaultToolsEnabled,
			'App Defaults Default Tools Enabled',
		);
		addOptionalEnumRowOverride(
			overrides,
			dottedConfigKey('apps', id, 'default_tools_approval_mode'),
			item.defaultToolsApprovalMode,
		);
	}
}

function appendAppToolOverrides(
	overrides: ConfigOverrideAccumulator,
	value: unknown,
): void {
	for (const item of collectionItems(value, 'tool')) {
		const appId = stringOption(item.appId);
		const toolId = stringOption(item.toolId);
		if (!appId && !toolId && !rowHasValues(item, ['enabled', 'approvalMode'])) {
			continue;
		}
		if (!appId || !toolId) {
			throw new Error('App Tool Overrides rows require App ID and Tool ID');
		}
		const prefix = dottedConfigKey('apps', appId, 'tools', toolId);
		addOptionalBooleanRowOverride(
			overrides,
			`${prefix}.enabled`,
			item.enabled,
			'App Tool Enabled',
		);
		addOptionalEnumRowOverride(
			overrides,
			`${prefix}.approval_mode`,
			item.approvalMode,
		);
	}
}

function appendMcpServerConfigOverrides(
	overrides: ConfigOverrideAccumulator,
	value: unknown,
): void {
	for (const item of collectionItems(value, 'server')) {
		const id = stringOption(item.id);
		if (
			!id &&
			!rowHasValues(item, [
				'command',
				'args',
				'cwd',
				'url',
				'bearerTokenEnvVar',
				'enabled',
				'required',
				'startupTimeoutSec',
				'startupTimeoutMs',
				'toolTimeoutSec',
				'enabledTools',
				'disabledTools',
				'defaultToolsApprovalMode',
				'scopes',
				'oauthResource',
				'experimentalEnvironment',
			])
		) {
			continue;
		}
		if (!id) throw new Error('MCP Server Config rows require Server ID');
		const prefix = dottedConfigKey('mcp_servers', id);
		addOptionalStringRowOverride(overrides, `${prefix}.command`, item.command);
		addOptionalStringArrayRowOverride(overrides, `${prefix}.args`, item.args);
		addOptionalStringRowOverride(overrides, `${prefix}.cwd`, item.cwd);
		addOptionalStringRowOverride(overrides, `${prefix}.url`, item.url);
		addOptionalStringRowOverride(
			overrides,
			`${prefix}.bearer_token_env_var`,
			item.bearerTokenEnvVar,
		);
		addOptionalBooleanRowOverride(
			overrides,
			`${prefix}.enabled`,
			item.enabled,
			'MCP Server Enabled',
		);
		addOptionalBooleanRowOverride(
			overrides,
			`${prefix}.required`,
			item.required,
			'MCP Server Required',
		);
		addOptionalNumberRowOverride(
			overrides,
			`${prefix}.startup_timeout_sec`,
			item.startupTimeoutSec,
			'MCP Server Startup Timeout Seconds',
		);
		addOptionalNumberRowOverride(
			overrides,
			`${prefix}.startup_timeout_ms`,
			item.startupTimeoutMs,
			'MCP Server Startup Timeout Milliseconds',
		);
		addOptionalNumberRowOverride(
			overrides,
			`${prefix}.tool_timeout_sec`,
			item.toolTimeoutSec,
			'MCP Server Tool Timeout Seconds',
		);
		addOptionalStringArrayRowOverride(
			overrides,
			`${prefix}.enabled_tools`,
			item.enabledTools,
		);
		addOptionalStringArrayRowOverride(
			overrides,
			`${prefix}.disabled_tools`,
			item.disabledTools,
		);
		addOptionalEnumRowOverride(
			overrides,
			`${prefix}.default_tools_approval_mode`,
			item.defaultToolsApprovalMode,
		);
		addOptionalStringArrayRowOverride(
			overrides,
			`${prefix}.scopes`,
			item.scopes,
		);
		addOptionalStringRowOverride(
			overrides,
			`${prefix}.oauth_resource`,
			item.oauthResource,
		);
		addOptionalEnumRowOverride(
			overrides,
			`${prefix}.experimental_environment`,
			item.experimentalEnvironment,
		);
	}
}

function appendMcpServerEnvironmentOverrides(
	overrides: ConfigOverrideAccumulator,
	value: unknown,
): void {
	for (const item of collectionItems(value, 'env')) {
		const serverId = stringOption(item.serverId);
		const name = stringOption(item.name);
		const envValue = stringOption(item.value);
		if (!serverId && !name && !envValue) continue;
		if (!serverId || !name || !envValue) {
			throw new Error(
				'MCP Server Environment rows require Server ID, Name, and Value',
			);
		}
		addStringConfigOverride(
			overrides,
			dottedConfigKey('mcp_servers', serverId, 'env', name),
			envValue,
		);
	}
}

function appendMcpServerHttpHeaderOverrides(
	overrides: ConfigOverrideAccumulator,
	value: unknown,
): void {
	for (const item of collectionItems(value, 'header')) {
		const serverId = stringOption(item.serverId);
		const name = stringOption(item.name);
		const headerValue = stringOption(item.value);
		const source = stringOption(item.source) || 'static';
		if (!serverId && !name && !headerValue) continue;
		if (!serverId || !name || !headerValue) {
			throw new Error(
				'MCP Server HTTP Headers rows require Server ID, Header Name, and Value',
			);
		}
		const headerTable = source === 'env' ? 'env_http_headers' : 'http_headers';
		addStringConfigOverride(
			overrides,
			dottedConfigKey('mcp_servers', serverId, headerTable, name),
			headerValue,
		);
	}
}

function appendMcpToolApprovalOverrides(
	overrides: ConfigOverrideAccumulator,
	value: unknown,
): void {
	for (const item of collectionItems(value, 'tool')) {
		const serverId = stringOption(item.serverId);
		const toolName = stringOption(item.toolName);
		const approvalMode = stringOption(item.approvalMode);
		if (
			!serverId &&
			!toolName &&
			(!approvalMode || approvalMode === 'default')
		) {
			continue;
		}
		if (!serverId || !toolName || !approvalMode || approvalMode === 'default') {
			throw new Error(
				'MCP Tool Approval rows require Server ID, Tool Name, and Approval Mode',
			);
		}
		addStringConfigOverride(
			overrides,
			dottedConfigKey(
				'mcp_servers',
				serverId,
				'tools',
				toolName,
				'approval_mode',
			),
			approvalMode,
		);
	}
}

function appendPluginMcpServerToolOverrides(
	overrides: ConfigOverrideAccumulator,
	value: unknown,
): void {
	for (const item of collectionItems(value, 'server')) {
		const pluginId = stringOption(item.pluginId);
		const serverId = stringOption(item.serverId);
		if (
			!pluginId &&
			!serverId &&
			!rowHasValues(item, [
				'enabledTools',
				'disabledTools',
				'defaultToolsApprovalMode',
			])
		) {
			continue;
		}
		if (!pluginId || !serverId) {
			throw new Error(
				'Plugin MCP Server Tools rows require Plugin ID and MCP Server ID',
			);
		}
		const prefix = dottedConfigKey(
			'plugins',
			pluginId,
			'mcp_servers',
			serverId,
		);
		addOptionalStringArrayRowOverride(
			overrides,
			`${prefix}.enabled_tools`,
			item.enabledTools,
		);
		addOptionalStringArrayRowOverride(
			overrides,
			`${prefix}.disabled_tools`,
			item.disabledTools,
		);
		addOptionalEnumRowOverride(
			overrides,
			`${prefix}.default_tools_approval_mode`,
			item.defaultToolsApprovalMode,
		);
	}
}

function appendPluginMcpToolApprovalOverrides(
	overrides: ConfigOverrideAccumulator,
	value: unknown,
): void {
	for (const item of collectionItems(value, 'tool')) {
		const pluginId = stringOption(item.pluginId);
		const serverId = stringOption(item.serverId);
		const toolName = stringOption(item.toolName);
		const approvalMode = stringOption(item.approvalMode);
		if (
			!pluginId &&
			!serverId &&
			!toolName &&
			(!approvalMode || approvalMode === 'default')
		) {
			continue;
		}
		if (
			!pluginId ||
			!serverId ||
			!toolName ||
			!approvalMode ||
			approvalMode === 'default'
		) {
			throw new Error(
				'Plugin MCP Tool Approval rows require Plugin ID, MCP Server ID, Tool Name, and Approval Mode',
			);
		}
		addStringConfigOverride(
			overrides,
			dottedConfigKey(
				'plugins',
				pluginId,
				'mcp_servers',
				serverId,
				'tools',
				toolName,
				'approval_mode',
			),
			approvalMode,
		);
	}
}

function appendShellEnvironmentListOverrides(
	overrides: ConfigOverrideAccumulator,
	value: unknown,
): void {
	for (const item of collectionItems(value, 'list')) {
		const listName = stringOption(item.listName);
		const patterns = commaSeparatedStrings(item.patterns);
		if (!patterns.length) continue;
		if (listName !== 'exclude' && listName !== 'include_only') {
			throw new Error('Shell Environment Lists rows require a valid List');
		}
		addArrayConfigOverride(
			overrides,
			`shell_environment_policy.${listName}`,
			patterns,
		);
	}
}

function appendShellEnvironmentSetOverrides(
	overrides: ConfigOverrideAccumulator,
	value: unknown,
): void {
	for (const item of collectionItems(value, 'env')) {
		const name = stringOption(item.name);
		const envValue = stringOption(item.value);
		if (!name && !envValue) continue;
		if (!name || !envValue) {
			throw new Error('Shell Environment Set rows require Name and Value');
		}
		addStringConfigOverride(
			overrides,
			dottedConfigKey('shell_environment_policy', 'set', name),
			envValue,
		);
	}
}

function appendConfigStringListOverrides(
	overrides: ConfigOverrideAccumulator,
	value: unknown,
): void {
	for (const item of collectionItems(value, 'list')) {
		const configKey = stringOption(item.configKey);
		const values = commaSeparatedStrings(item.values);
		if (!values.length) continue;
		if (!configKey)
			throw new Error('Config String Lists rows require Config Key');
		addArrayConfigOverride(overrides, configKey, values);
	}
}

function appendAgentRoleOverrides(
	overrides: ConfigOverrideAccumulator,
	value: unknown,
): void {
	for (const item of collectionItems(value, 'role')) {
		const name = stringOption(item.name);
		if (
			!name &&
			!rowHasValues(item, ['description', 'configFile', 'nicknameCandidates'])
		) {
			continue;
		}
		if (!name) throw new Error('Agent Roles rows require Role Name');
		const prefix = dottedConfigKey('agents', name);
		addOptionalStringRowOverride(
			overrides,
			`${prefix}.description`,
			item.description,
		);
		addOptionalStringRowOverride(
			overrides,
			`${prefix}.config_file`,
			item.configFile,
		);
		addOptionalStringArrayRowOverride(
			overrides,
			`${prefix}.nickname_candidates`,
			item.nicknameCandidates,
		);
	}
}

function appendSkillsConfigOverrides(
	overrides: ConfigOverrideAccumulator,
	value: unknown,
): void {
	let index = 0;
	for (const item of collectionItems(value, 'skill')) {
		const path = stringOption(item.path);
		const enabled = stringOption(item.enabled);
		if (!path && (!enabled || enabled === 'default')) continue;
		if (!path || !enabled || enabled === 'default') {
			throw new Error('Skills Config rows require Path and Enabled');
		}
		const prefix = `skills.config.${index}`;
		addStringConfigOverride(overrides, `${prefix}.path`, path);
		addConfigOverride(overrides, `${prefix}.enabled`, enabled);
		index++;
	}
}

function appendProjectTrustOverrides(
	overrides: ConfigOverrideAccumulator,
	value: unknown,
): void {
	for (const item of collectionItems(value, 'project')) {
		const path = stringOption(item.path);
		const trustLevel = stringOption(item.trustLevel);
		if (!path && (!trustLevel || trustLevel === 'default')) continue;
		if (!path || !trustLevel || trustLevel === 'default') {
			throw new Error('Project Trust rows require Path and Trust Level');
		}
		addStringConfigOverride(
			overrides,
			dottedConfigKey('projects', path, 'trust_level'),
			trustLevel,
		);
	}
}

function appendProfileConfigOverrides(
	overrides: ConfigOverrideAccumulator,
	value: unknown,
): void {
	for (const item of collectionItems(value, 'override')) {
		const profileName = stringOption(item.profileName);
		const configKey = stringOption(item.configKey);
		const overrideValue = stringOption(item.value);
		if (!profileName && !configKey && !overrideValue) continue;
		if (!profileName || !configKey || !overrideValue) {
			throw new Error(
				'Profile Config Overrides rows require Profile Name, Config Key, and Value',
			);
		}
		addConfigOverride(
			overrides,
			`profiles.${quoteConfigKeySegment(profileName)}.${configKey}`,
			overrideValue,
		);
	}
}

function appendPermissionFilesystemRuleOverrides(
	overrides: ConfigOverrideAccumulator,
	value: unknown,
): void {
	for (const item of collectionItems(value, 'rule')) {
		const profileName = stringOption(item.profileName);
		const path = stringOption(item.path);
		const access = stringOption(item.access);
		if (!profileName && !path && !access) continue;
		if (!profileName || !path || !access) {
			throw new Error(
				'Permission Filesystem Rules rows require Permission Profile, Path Or Glob, and Access',
			);
		}
		addStringConfigOverride(
			overrides,
			dottedConfigKey('permissions', profileName, 'filesystem', path),
			access,
		);
	}
}

function appendPermissionNetworkOverrides(
	overrides: ConfigOverrideAccumulator,
	value: unknown,
): void {
	for (const item of collectionItems(value, 'network')) {
		const profileName = stringOption(item.profileName);
		if (
			!profileName &&
			!rowHasValues(item, [
				'enabled',
				'mode',
				'proxyUrl',
				'enableSocks5',
				'socksUrl',
				'enableSocks5Udp',
				'allowUpstreamProxy',
				'allowLocalBinding',
				'dangerouslyAllowNonLoopbackProxy',
				'dangerouslyAllowAllUnixSockets',
			])
		) {
			continue;
		}
		if (!profileName) {
			throw new Error('Permission Network rows require Permission Profile');
		}
		const prefix = dottedConfigKey('permissions', profileName, 'network');
		addOptionalBooleanRowOverride(
			overrides,
			`${prefix}.enabled`,
			item.enabled,
			'Permission Network Enabled',
		);
		addOptionalEnumRowOverride(overrides, `${prefix}.mode`, item.mode);
		addOptionalStringRowOverride(
			overrides,
			`${prefix}.proxy_url`,
			item.proxyUrl,
		);
		addOptionalBooleanRowOverride(
			overrides,
			`${prefix}.enable_socks5`,
			item.enableSocks5,
			'Permission Network Enable SOCKS5',
		);
		addOptionalStringRowOverride(
			overrides,
			`${prefix}.socks_url`,
			item.socksUrl,
		);
		addOptionalBooleanRowOverride(
			overrides,
			`${prefix}.enable_socks5_udp`,
			item.enableSocks5Udp,
			'Permission Network Enable SOCKS5 UDP',
		);
		addOptionalBooleanRowOverride(
			overrides,
			`${prefix}.allow_upstream_proxy`,
			item.allowUpstreamProxy,
			'Permission Network Allow Upstream Proxy',
		);
		addOptionalBooleanRowOverride(
			overrides,
			`${prefix}.allow_local_binding`,
			item.allowLocalBinding,
			'Permission Network Allow Local Binding',
		);
		addOptionalBooleanRowOverride(
			overrides,
			`${prefix}.dangerously_allow_non_loopback_proxy`,
			item.dangerouslyAllowNonLoopbackProxy,
			'Permission Network Allow Non-Loopback Proxy',
		);
		addOptionalBooleanRowOverride(
			overrides,
			`${prefix}.dangerously_allow_all_unix_sockets`,
			item.dangerouslyAllowAllUnixSockets,
			'Permission Network Allow All Unix Sockets',
		);
	}
}

function appendPermissionNetworkDomainOverrides(
	overrides: ConfigOverrideAccumulator,
	value: unknown,
): void {
	for (const item of collectionItems(value, 'domain')) {
		const profileName = stringOption(item.profileName);
		const pattern = stringOption(item.pattern);
		const decision = stringOption(item.decision);
		if (!profileName && !pattern && !decision) continue;
		if (!profileName || !pattern || !decision) {
			throw new Error(
				'Permission Network Domains rows require Permission Profile, Domain Pattern, and Decision',
			);
		}
		addStringConfigOverride(
			overrides,
			dottedConfigKey(
				'permissions',
				profileName,
				'network',
				'domains',
				pattern,
			),
			decision,
		);
	}
}

function appendOtelExporterSettingOverrides(
	overrides: ConfigOverrideAccumulator,
	value: unknown,
): void {
	for (const item of collectionItems(value, 'exporter')) {
		const exporterType = stringOption(item.exporterType);
		const id = stringOption(item.id);
		if (
			!exporterType &&
			!id &&
			!rowHasValues(item, [
				'endpoint',
				'protocol',
				'caCertificate',
				'clientCertificate',
				'clientPrivateKey',
			])
		) {
			continue;
		}
		if (!exporterType || !id) {
			throw new Error(
				'OTEL Exporter Settings rows require Exporter Type and Exporter ID',
			);
		}
		const prefix = dottedConfigKey('otel', exporterType, id);
		addOptionalStringRowOverride(
			overrides,
			`${prefix}.endpoint`,
			item.endpoint,
		);
		addOptionalEnumRowOverride(overrides, `${prefix}.protocol`, item.protocol);
		addOptionalStringRowOverride(
			overrides,
			`${prefix}.tls.ca-certificate`,
			item.caCertificate,
		);
		addOptionalStringRowOverride(
			overrides,
			`${prefix}.tls.client-certificate`,
			item.clientCertificate,
		);
		addOptionalStringRowOverride(
			overrides,
			`${prefix}.tls.client-private-key`,
			item.clientPrivateKey,
		);
	}
}

function appendOtelExporterHeaderOverrides(
	overrides: ConfigOverrideAccumulator,
	value: unknown,
): void {
	for (const item of collectionItems(value, 'header')) {
		const exporterType = stringOption(item.exporterType);
		const id = stringOption(item.id);
		const name = stringOption(item.name);
		const headerValue = stringOption(item.value);
		if (!exporterType && !id && !name && !headerValue) continue;
		if (!exporterType || !id || !name || !headerValue) {
			throw new Error(
				'OTEL Exporter Headers rows require Exporter Type, Exporter ID, Header Name, and Value',
			);
		}
		addStringConfigOverride(
			overrides,
			dottedConfigKey('otel', exporterType, id, 'headers', name),
			headerValue,
		);
	}
}

function appendDocumentedConfigOverrides(
	overrides: ConfigOverrideAccumulator,
	value: unknown,
): void {
	for (const item of collectionItems(value, 'override')) {
		const key = stringOption(item.key);
		const overrideValue = stringOption(item.value);
		if (!key && !overrideValue) continue;
		if (!key || !overrideValue) {
			throw new Error(
				'Documented Advanced Config Overrides rows require Resolved Config Key and TOML Value',
			);
		}
		addConfigOverride(overrides, key, overrideValue);
	}
}

function addOptionalBooleanRowOverride(
	overrides: ConfigOverrideAccumulator,
	key: string,
	value: unknown,
	label: string,
): void {
	const state = stringOption(value);
	if (!state || state === 'default') return;
	if (state !== 'true' && state !== 'false') {
		throw new Error(`${label} must be Enabled or Disabled`);
	}
	addConfigOverride(overrides, key, state);
}

function addOptionalEnumRowOverride(
	overrides: ConfigOverrideAccumulator,
	key: string,
	value: unknown,
): void {
	const selectedValue = stringOption(value);
	if (!selectedValue || selectedValue === 'default') return;
	addStringConfigOverride(overrides, key, selectedValue);
}

function addOptionalNumberRowOverride(
	overrides: ConfigOverrideAccumulator,
	key: string,
	value: unknown,
	label: string,
): void {
	if (value === undefined || value === null || value === '') return;
	const numericValue =
		typeof value === 'number' ? value : Number.parseFloat(String(value));
	if (!Number.isFinite(numericValue)) {
		throw new Error(`${label} must be a finite number`);
	}
	addConfigOverride(overrides, key, String(numericValue));
}

function addOptionalStringRowOverride(
	overrides: ConfigOverrideAccumulator,
	key: string,
	value: unknown,
): void {
	const selectedValue = stringOption(value);
	if (!selectedValue) return;
	addStringConfigOverride(overrides, key, selectedValue);
}

function addOptionalStringArrayRowOverride(
	overrides: ConfigOverrideAccumulator,
	key: string,
	value: unknown,
): void {
	const values = commaSeparatedStrings(value);
	if (!values.length) return;
	addArrayConfigOverride(overrides, key, values);
}

function addArrayConfigOverride(
	overrides: ConfigOverrideAccumulator,
	key: string,
	values: string[],
): void {
	if (!values.length)
		throw new Error(`Config override array is empty for ${key}`);
	addConfigOverride(overrides, key, JSON.stringify(values));
}

function rowHasValues(item: IDataObject, names: string[]): boolean {
	for (const name of names) {
		const value = item[name];
		if (value === undefined || value === null || value === '') continue;
		if (value === 'default') continue;
		return true;
	}
	return false;
}

function commaSeparatedStrings(value: unknown): string[] {
	const rawValue = stringOption(value);
	if (!rawValue) return [];
	return rawValue
		.split(',')
		.map((entry) => entry.trim())
		.filter(Boolean);
}

function dottedConfigKey(...segments: string[]): string {
	return segments.map(quoteConfigKeySegment).join('.');
}

function quoteConfigKeySegment(segment: string): string {
	if (!segment) throw new Error('Config key segment is required');
	if (/^[A-Za-z0-9_-]+$/.test(segment)) return segment;
	return JSON.stringify(segment);
}

function addRawConfigOverride(
	overrides: ConfigOverrideAccumulator,
	override: string,
): void {
	const separatorIndex = override.indexOf('=');
	if (separatorIndex <= 0) {
		throw new Error('Raw Config Override rows must be formatted as key=value');
	}
	addConfigOverride(
		overrides,
		override.slice(0, separatorIndex),
		override.slice(separatorIndex + 1),
	);
}

function addStringConfigOverride(
	overrides: ConfigOverrideAccumulator,
	key: string,
	value: string,
): void {
	addConfigOverride(overrides, key, JSON.stringify(value));
}

function addConfigOverride(
	overrides: ConfigOverrideAccumulator,
	key: string,
	value: string,
): void {
	const normalizedKey = key.trim();
	const normalizedValue = value.trim();
	if (!normalizedKey) throw new Error('Config override key is required');
	if (!normalizedValue)
		throw new Error(`Config override value is required for ${normalizedKey}`);
	if (overrides.keys.has(normalizedKey)) {
		throw new Error(`Config override ${normalizedKey} is set more than once`);
	}
	overrides.keys.add(normalizedKey);
	overrides.values.push(`${normalizedKey}=${normalizedValue}`);
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
		throw new Error(
			'Use either Output Schema JSON or Output Schema File, not both',
		);
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

function buildCodexEnvironment(
	additionalOptions: IDataObject,
): NodeJS.ProcessEnv {
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

function mergePathEntries(
	currentPath: string | undefined,
	requiredEntries: string[],
): string {
	const existingEntries = currentPath
		? currentPath.split(':').filter(Boolean)
		: [];
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
): Promise<CodexProcessResult> {
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
			reject(
				new CodexProcessError(`Failed to spawn Codex process: ${err.message}`, {
					stdout,
					stderr,
					exitCode: null,
					signal: null,
					timedOut: false,
					processError: processErrorInfo(err),
				}),
			);
		});

		child.on('close', (code, signal) => {
			clearTimeout(timer);
			if (timedOut) {
				return reject(
					new CodexProcessError(`codex timed out after ${timeoutMs / 1000}s`, {
						stdout,
						stderr,
						exitCode: null,
						signal: null,
						timedOut: true,
						processError: null,
					}),
				);
			}
			if (signal) {
				return reject(
					new CodexProcessError(
						withCodexErrorDetails(`codex exited from signal ${signal}`, stderr),
						{
							stdout,
							stderr,
							exitCode: null,
							signal,
							timedOut: false,
							processError: null,
						},
					),
				);
			}
			if (code !== 0) {
				return reject(
					new CodexProcessError(
						withCodexErrorDetails(`codex exited with code ${code}`, stderr),
						{
							stdout,
							stderr,
							exitCode: code,
							signal: null,
							timedOut: false,
							processError: null,
						},
					),
				);
			}
			resolve({
				stdout,
				stderr,
				exitCode: 0,
				signal: null,
				timedOut: false,
				processError: null,
			});
		});
	});
}

function processErrorInfo(error: Error): IDataObject {
	const details = error as Error & {
		code?: unknown;
		errno?: unknown;
		syscall?: unknown;
		path?: unknown;
		spawnargs?: unknown;
	};
	return {
		name: error.name,
		message: error.message,
		stack: error.stack ?? null,
		code: details.code ?? null,
		errno: details.errno ?? null,
		syscall: details.syscall ?? null,
		path: details.path ?? null,
		spawnargs: details.spawnargs ?? null,
	};
}

function withCodexErrorDetails(message: string, stderr: string): string {
	const details = stderr
		.split(/\r?\n/)
		.map((line) => line.trim())
		.filter((line) => line.length > 0)
		.join(' | ');
	if (!details) return message;
	return `${message}: ${details}`;
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

		const sessionId = firstString(
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

		const status = firstString(
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
			const role =
				stringValue(message.role) ??
				inferRoleFromSource(source, event) ??
				'assistant';
			const content = message.content ?? message.text ?? message.message;
			return {
				role,
				content,
				text: extractText(content),
			};
		}

		const item = asRecord(source.item);
		if (item && (item.type === 'message' || item.role !== undefined)) {
			const role =
				stringValue(item.role) ??
				inferRoleFromSource(source, event) ??
				'assistant';
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
					role:
						stringValue(source.role) ??
						inferRoleFromSource(source, event) ??
						'assistant',
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
			name: firstString(
				source.name,
				source.tool_name,
				getNested(source, ['function', 'name']),
			),
			status: stringValue(source.status),
			input:
				source.input ??
				source.arguments ??
				getNested(source, ['function', 'arguments']),
			output: source.output ?? source.result,
		};
	}

	return undefined;
}

function extractExplicitFinalText(event: JsonEvent): string | undefined {
	const types = eventSources(event).map((source) =>
		typeForSource(source, event),
	);
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
	return (
		stringValue(source.role) ?? inferRoleFromType(typeForSource(source, event))
	);
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

function typeForSource(
	source: Record<string, unknown>,
	event: JsonEvent,
): string {
	return (
		stringValue(source.type) ??
		(source === event ? undefined : stringValue(event.type)) ??
		''
	);
}

function stringOption(value: unknown): string {
	return typeof value === 'string' ? value.trim() : '';
}

function enumOption<T extends string>(value: unknown, defaultValue: T): T {
	return typeof value === 'string' && value.length > 0
		? (value as T)
		: defaultValue;
}

function collectionItems(
	value: unknown,
	collectionName: string,
): IDataObject[] {
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
