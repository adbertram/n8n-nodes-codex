// Lightweight smoke test that drives the compiled node with a mock
// IExecuteFunctions context. Calls the local `codex` binary once.

const path = require('path');
const { Codex } = require(path.resolve(
	__dirname,
	'dist/nodes/Codex/Codex.node.js',
));

function makeMockContext(params) {
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
			return false;
		},
		getNode() {
			return { name: 'Codex', type: 'codex', typeVersion: 1 };
		},
	};
}

async function runCase(label, params) {
	console.log(`\n=== ${label} ===`);
	const node = new Codex();
	const ctx = makeMockContext(params);
	const result = await node.execute.call(ctx);
	const out = result[0][0].json;

	if (params.outputFormat === 'structured') {
		console.log('finalResult:', JSON.stringify(out.finalResult));
		console.log('sessionId  :', out.sessionId);
		console.log('threadId   :', out.threadId);
		console.log('model      :', out.model);
		console.log('status     :', out.status);
		console.log('isError    :', out.isError);
		console.log('eventsCount:', out.eventsCount);
		console.log('toolCalls  :', out.toolCalls?.length ?? 0);
		console.log('messages   :', out.messages?.length ?? 0);
	} else if (params.outputFormat === 'text') {
		console.log('text:', JSON.stringify(out.text));
	} else {
		console.log('events count:', out.events?.length);
	}
}

(async () => {
	const baseParams = {
		prompt: 'Reply with just the single word "ok" and nothing else.',
		outputFormat: 'structured',
		model: '',
		workingDirectory: '',
		resumeMode: 'new',
		sessionId: '',
		sandboxMode: 'workspace-write',
		approvalPolicy: 'never',
		additionalOptions: {
			timeout: 120,
			codexBinaryPath: 'codex',
			skipGitRepoCheck: true,
		},
	};

	try {
		await runCase('structured', baseParams);
		await runCase('text', { ...baseParams, outputFormat: 'text' });
		console.log('\nSMOKE OK');
	} catch (err) {
		console.error('SMOKE FAIL:', err.message);
		process.exit(1);
	}
})();
