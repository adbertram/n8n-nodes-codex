module.exports = {
	root: true,
	parser: '@typescript-eslint/parser',
	parserOptions: {
		project: './tsconfig.json',
		sourceType: 'module',
	},
	env: {
		node: true,
		es2022: true,
	},
	extends: ['eslint:recommended'],
	rules: {
		'no-undef': 'off',
		'no-unused-vars': 'off',
	},
};
