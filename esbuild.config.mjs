import esbuild from "esbuild";
import process from "process";
import { builtinModules } from "module";
import { readdirSync, readFileSync } from "fs";
import { createHash } from "crypto";

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
// that build did not yet contain (28 aug 2026).
//
// It stamped the *minute* at first, and that was a mistake with a cost: a
// clock makes every build unique, so rebuilding the released source can never
// reproduce the released bytes. The listing's build verification said so on
// 0.1.8 — "build output does not match the released main.js artifact" — and
// it was right (BC_E3_S77).
//
// So the stamp comes from the source instead: a short hash over everything
// that ships. Same source, same stamp, same bytes — reproducible by anyone
// with the tag. Different source, different stamp, which is the only thing
// it was ever for. Better than a clock, too: it names *what* was built
// rather than *when*, so two builds of one commit agree, as they should.
const stamped = createHash("sha256");
for (const file of [...shipped("src"), "manifest.json", "styles.css"].sort()) {
	stamped.update(file);
	stamped.update(readFileSync(file));
}
const built = stamped.digest("hex").slice(0, 8);

/** Every source file that ends up in the plugin. Tests ship with nothing. */
function shipped(dir) {
	const found = [];
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		const path = `${dir}/${entry.name}`;
		if (entry.isDirectory()) {
			if (entry.name !== "__tests__") found.push(...shipped(path));
		} else if (entry.name.endsWith(".ts")) {
			found.push(path);
		}
	}
	return found;
}

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
