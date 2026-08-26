import obsidianmd from "eslint-plugin-obsidianmd";
import tseslint from "typescript-eslint";

export default tseslint.config(
	// eslint-plugin-obsidianmd exports `recommended` as a full flat-config
	// array (incl. typescript-eslint + the obsidianmd rules).
	...obsidianmd.configs.recommended,
	{
		files: ["src/**/*.ts"],
		languageOptions: {
			parserOptions: {
				projectService: true,
				tsconfigRootDir: import.meta.dirname,
			},
		},
		rules: {
			"@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
			"@typescript-eslint/no-deprecated": "warn",
			// The sentence-case heuristic lowercases proper nouns; UI text is
			// hand-kept in sentence case.
			"obsidianmd/ui/sentence-case": "off",
		},
	},
	{
		// The architectural boundary from the build brief §5, enforced rather
		// than merely documented: model/, parse/ and layout/ are pure. They
		// must stay headless-testable, so nothing there may reach into the
		// Obsidian API — the vault/ and view/ layers are the only Obsidian side.
		files: ["src/model/**/*.ts", "src/parse/**/*.ts", "src/layout/**/*.ts"],
		rules: {
			"no-restricted-imports": [
				"error",
				{
					paths: [
						{
							name: "obsidian",
							message:
								"model/, parse/ and layout/ must stay Obsidian-free so they remain headless-testable. Put Obsidian API use in vault/ or view/ and pass plain data in.",
						},
					],
				},
			],
		},
	},
	{
		// Tests run under vitest/node, never inside an Obsidian window. They may
		// therefore reach for node built-ins — one of them reads the source tree
		// to check how it calls the Obsidian DOM helpers.
		files: ["src/__tests__/**/*.ts"],
		languageOptions: {
			globals: { __dirname: "readonly" },
		},
		rules: {
			"obsidianmd/prefer-window-timers": "off",
			"obsidianmd/prefer-active-doc": "off",
			"obsidianmd/no-nodejs-modules": "off",
		},
	},
	{
		ignores: ["main.js", "node_modules/"],
	},
);
