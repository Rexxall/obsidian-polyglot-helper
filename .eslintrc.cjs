// The community directory's scorecard checks types without dev dependencies such as @types/node;
// tsconfig.lint.json does the same, so these rules catch what it would.
module.exports = {
	root: true,
	parser: '@typescript-eslint/parser',
	plugins: ['@typescript-eslint'],
	parserOptions: { project: './tsconfig.lint.json', tsconfigRootDir: __dirname },
	ignorePatterns: ['main.js', 'node_modules/', '*.mjs', 'src/main-mobile-simple.ts', 'src/main-mobile-test.ts'],
	rules: {
		'@typescript-eslint/no-unsafe-argument': 'error',
		'@typescript-eslint/no-unsafe-assignment': 'error',
		'@typescript-eslint/no-unsafe-call': 'error',
		'@typescript-eslint/no-unsafe-member-access': 'error',
		'@typescript-eslint/no-unsafe-return': 'error',
		'@typescript-eslint/no-redundant-type-constituents': 'error',
		'@typescript-eslint/no-duplicate-type-constituents': 'error',
		'@typescript-eslint/no-unnecessary-type-assertion': 'error',
	},
};
