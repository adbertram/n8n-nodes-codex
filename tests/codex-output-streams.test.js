const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { Codex } = require(path.resolve(
	__dirname,
	'../dist/nodes/Codex/Codex.node.js',
));

function makeScript(contents) {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-node-test-'));
	const file = path.join(dir, 'codex-fixture');
	fs.writeFileSync(file, contents, { mode: 0o755 });
	return { dir, file };
}

function makeMissingBinary() {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-node-missing-'));
	return path.join(dir, 'missing-codex');
}

function makeContext(params, continueOnFail, credentials) {
	return {
		getInputData() {
			return [{ json: {} }];
		},
		async getCredentials() {
			return credentials;
		},
		getNodeParameter(name, _itemIndex, fallback) {
			return Object.prototype.hasOwnProperty.call(params, name)
				? params[name]
				: fallback;
		},
		continueOnFail() {
			return continueOnFail;
		},
		getNode() {
			return { name: 'Codex', type: 'codex', typeVersion: 1 };
		},
	};
}

async function execute(params, continueOnFail = false, credentials = {}) {
	const node = new Codex();
	const result = await node.execute.call(
		makeContext(params, continueOnFail, {
			codexPath: params.codexPath,
			runAsUser: '',
			authMethod: 'chatgpt',
			apiKey: '',
			codexHome: '',
			...credentials,
		}),
	);
	return result[0][0].json;
}

function baseParams(codexBinaryPath) {
	return {
		codexPath: codexBinaryPath,
		prompt: 'Test prompt',
		outputFormat: 'text',
		model: '',
		workingDirectory: '',
		resumeMode: 'new',
		sessionId: '',
		sandboxMode: 'workspace-write',
		approvalPolicy: 'never',
		additionalOptions: {
			timeout: 30,
			skipGitRepoCheck: true,
		},
	};
}

(async () => {
	const success = makeScript(`#!/bin/sh
printf 'final stdout\\n'
printf 'diagnostic stderr\\n' >&2
exit 0
`);
	const successOutput = await execute(baseParams(success.file));
	assert.deepStrictEqual(successOutput, {
		text: 'final stdout',
		stdout: 'final stdout\n',
		stderr: 'diagnostic stderr\n',
		exitCode: 0,
		signal: null,
		timedOut: false,
		processError: null,
	});

	const failure = makeScript(`#!/bin/sh
printf 'failure stdout\\n'
printf 'failure stderr\\n' >&2
exit 7
`);
	const failureOutput = await execute(baseParams(failure.file));
	assert.strictEqual(failureOutput.text, 'failure stdout');
	assert.strictEqual(failureOutput.stdout, 'failure stdout\n');
	assert.strictEqual(failureOutput.stderr, 'failure stderr\n');
	assert.match(failureOutput.error, /codex exited with code 7/);
	assert.strictEqual(failureOutput.exitCode, 7);
	assert.strictEqual(failureOutput.signal, null);
	assert.strictEqual(failureOutput.timedOut, false);

	const missingOutput = await execute(baseParams(makeMissingBinary()));
	assert.strictEqual(missingOutput.stdout, '');
	assert.strictEqual(missingOutput.stderr, '');
	assert.match(missingOutput.error, /Failed to spawn Codex process: spawn .* ENOENT/);
	assert.strictEqual(missingOutput.exitCode, null);
	assert.strictEqual(missingOutput.signal, null);
	assert.strictEqual(missingOutput.timedOut, false);
	assert.strictEqual(missingOutput.processError.code, 'ENOENT');

	const argvPrinter = makeScript(`#!/bin/sh
for arg in "$@"; do
	printf '%s\\n' "$arg"
done
exit 0
`);
	const defaultArgvOutput = await execute(baseParams(argvPrinter.file));
	assert.doesNotMatch(defaultArgvOutput.stdout, /^--ignore-user-config$/m);
	assert.match(defaultArgvOutput.stdout, /^--skip-git-repo-check$/m);

	const ignoreConfigParams = baseParams(argvPrinter.file);
	ignoreConfigParams.additionalOptions.ignoreUserConfig = true;
	const ignoreConfigArgvOutput = await execute(ignoreConfigParams);
	assert.match(ignoreConfigArgvOutput.stdout, /^--ignore-user-config$/m);
	// API-key auth: the node signs in first, then runs codex exec in the same CODEX_HOME.
	const authRecorder = makeScript(`#!/bin/sh
if [ "$1" = "login" ]; then
	read -r key
	printf '%s' "$key" > "$CODEX_HOME/auth.json"
	exit 0
fi
printf 'home=%s auth=%s\\n' "$CODEX_HOME" "$(cat "$CODEX_HOME/auth.json")"
exit 0
`);
	const apiKeyOutput = await execute(baseParams(authRecorder.file), false, {
		authMethod: 'apiKey',
		apiKey: 'sk-test-key',
	});
	assert.match(apiKeyOutput.text, /^home=\S*codex-home-\S* auth=sk-test-key$/);

	const missingKeyParams = baseParams(authRecorder.file);
	const missingKeyOutput = await execute(missingKeyParams, true, {
		authMethod: 'apiKey',
		apiKey: '',
	});
	assert.match(missingKeyOutput.error, /API Key is required/);

	const explicitHome = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-home-explicit-'));
	const explicitHomeOutput = await execute(baseParams(authRecorder.file), false, {
		authMethod: 'apiKey',
		apiKey: 'sk-explicit',
		codexHome: explicitHome,
	});
	assert.strictEqual(
		explicitHomeOutput.text,
		`home=${explicitHome} auth=sk-explicit`,
	);

	// Environment JSON is applied after CODEX_HOME and the Environment Variables collection.
	const envPrinter = makeScript(`#!/bin/sh
printf '%s|%s\\n' "$CODEX_HOME" "$RUN_MARKER"
exit 0
`);
	const environmentParams = baseParams(envPrinter.file);
	environmentParams.additionalOptions.envVars = {
		env: [{ name: 'RUN_MARKER', value: 'collection' }],
	};
	environmentParams.additionalOptions.environment =
		'{"CODEX_HOME": "/run/codex-home", "RUN_MARKER": "json"}';
	const environmentOutput = await execute(environmentParams);
	assert.strictEqual(environmentOutput.text, '/run/codex-home|json');

	// A sandbox profile confines where Codex may write.
	const allowed = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'codex-allowed-')));
	const denied = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'codex-denied-')));
	const writer = makeScript(`#!/bin/sh
touch "${allowed}/ok"
touch "${denied}/no"
exit 0
`);
	const sandboxParams = baseParams(writer.file);
	sandboxParams.additionalOptions.sandboxProfile = [
		'(version 1)',
		'(allow default)',
		'(deny file-write*)',
		`(allow file-write* (subpath "${allowed}") (literal "/dev/null"))`,
	].join('\n');
	await execute(sandboxParams);
	assert.strictEqual(fs.existsSync(path.join(allowed, 'ok')), true);
	assert.strictEqual(fs.existsSync(path.join(denied, 'no')), false);

	const sandboxAsUser = await execute(sandboxParams, true, { runAsUser: 'someone' });
	assert.match(sandboxAsUser.error, /cannot be combined with Run As User/);

	// A timeout kills every process Codex started, not only Codex.
	const marker = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'codex-grandchild-')), 'pid');
	const spawner = makeScript(`#!/bin/sh
sleep 300 &
echo $! > "${marker}"
wait
`);
	const timeoutParams = baseParams(spawner.file);
	timeoutParams.additionalOptions.timeout = 1;
	const timeoutOutput = await execute(timeoutParams);
	assert.strictEqual(timeoutOutput.timedOut, true);
	assert.throws(
		() => process.kill(Number(fs.readFileSync(marker, 'utf8').trim()), 0),
		{ code: 'ESRCH' },
	);
})();
