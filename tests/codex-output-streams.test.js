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

function makeContext(params, continueOnFail) {
	return {
		getInputData() {
			return [{ json: {} }];
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

async function execute(params, continueOnFail = false) {
	const node = new Codex();
	const result = await node.execute.call(makeContext(params, continueOnFail));
	return result[0][0].json;
}

function baseParams(codexBinaryPath) {
	return {
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
			codexBinaryPath,
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
})();
