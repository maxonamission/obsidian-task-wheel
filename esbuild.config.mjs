import esbuild from "esbuild";
import process from "process";
import { builtinModules } from "module";
import { readFileSync } from "fs";

const prod = process.argv[2] === "production";

// Stamp the plugin version into a banner so every build produces a main.js whose
// bytes (and therefore sha256 digest) are unique per version — the release-asset
// attestation lesson from Readability Compass (BC_E1_S26).
const version = JSON.parse(readFileSync("manifest.json", "utf8")).version;

const context = await esbuild.context({
	entryPoints: ["src/main.ts"],
	bundle: true,
	external: [
		"obsidian",
		"electron",
		"@codemirror/state",
		"@codemirror/view",
		...builtinModules,
	],
	banner: {
		js: `/* Task Wheel ${version} — https://github.com/maxonamission/codebase-basecamp */`,
	},
	format: "cjs",
	target: "es2018",
	logLevel: "info",
	sourcemap: prod ? false : "inline",
	treeShaking: true,
	outfile: "main.js",
});

if (prod) {
	await context.rebuild();
	process.exit(0);
} else {
	await context.watch();
}
