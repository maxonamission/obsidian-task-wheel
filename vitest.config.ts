import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		include: ["src/__tests__/**/*.test.ts"],
	},
	resolve: {
		alias: {
			// `src/vault/` is the one layer that must import from `obsidian`, and
			// that import is the only reason none of it could be tested. The stub
			// carries the handful of values used at module level or with
			// `instanceof`; everything else about those modules is ordinary code
			// and now has a way in.
			obsidian: fileURLToPath(
				new URL("./src/__tests__/fixtures/obsidian-stub.ts", import.meta.url),
			),
		},
	},
});
