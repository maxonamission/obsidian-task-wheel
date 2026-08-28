import esbuild from "esbuild";
import process from "process";
import { builtinModules } from "module";
import { readFileSync } from "fs";

const prod = process.argv[2] === "production";

// Stamp the plugin version into a banner so every build produces a main.js whose
// bytes (and therefore sha256 digest) are unique per version — the release-asset
// attestation lesson from Readability Compass (BC_E1_S26).
const version = JSON.parse(readFileSync("manifest.json", "utf8")).version;

// And a stamp for *this* build, which the version cannot give.
//
// Between two releases there are a dozen test builds, all carrying the same
// version. When a trace comes back from the owner's phone, "0.1.7" cannot say
// which of them produced it — and a round was spent reading a trace for a fix
// that build did not yet contain (28 aug 2026). The minute the bundle was made
// tells them apart, and travels in the diagnostics header.
const built = new Date()
	.toISOString()
	.slice(0, 16)
	.replace("T", " ");

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
		js: `/* Task Wheel ${version} (build ${built}) — https://github.com/maxonamission/codebase-basecamp */`,
	},
	define: {
		__TASK_WHEEL_BUILD__: JSON.stringify(built),
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
