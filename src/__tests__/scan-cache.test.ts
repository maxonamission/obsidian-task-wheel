import { describe, expect, it } from "vitest";
import { ScanCache } from "../vault/scan";
import { VAULT_SCOPE, type WheelScope } from "../model/types";

/**
 * What a scan is allowed to keep between rounds.
 *
 * Reading and outlining a five-thousand-note vault costs about two tenths of a
 * second, and a rescan runs on every burst of vault activity — a sync landing,
 * another plugin writing, the reader saving one line. Keeping the outlines
 * halves that (measured 17 aug 2026: ~200 ms cold, ~80 ms warm).
 *
 * The whole risk of a cache is showing somebody yesterday's vault, so these
 * tests are about *when it must not reuse*, not about the speed.
 */

interface FakeFile {
	path: string;
	stat: { mtime: number; size: number };
	content: string;
}

/** The bit of Obsidian a scan touches, and nothing more. */
function vaultOf(files: FakeFile[]) {
	let reads = 0;
	const app = {
		vault: {
			getMarkdownFiles: () => files,
			cachedRead: (file: FakeFile) => {
				reads += 1;
				return Promise.resolve(file.content);
			},
		},
		metadataCache: { getFileCache: () => null },
	};
	return { app, reads: () => reads };
}

function note(path: string, content: string, mtime = 1000): FakeFile {
	return { path, content, stat: { mtime, size: content.length } };
}

/** The cache takes an `App`; the stub is deliberately not one. */
const read = async (cache: ScanCache, app: unknown, scope: WheelScope = VAULT_SCOPE) =>
	cache.read(app as Parameters<ScanCache["read"]>[0], scope);

describe("what a second scan may reuse", () => {
	it("reads everything the first time", async () => {
		const files = [note("A.md", "- [ ] Een"), note("B.md", "- [ ] Twee")];
		const { app, reads } = vaultOf(files);
		const cache = new ScanCache();

		const outlined = await read(cache, app);

		expect(reads()).toBe(2);
		expect(cache.reused).toBe(0);
		expect(outlined).toHaveLength(2);
	});

	it("reads nothing the second time when nothing changed", async () => {
		const files = [note("A.md", "- [ ] Een"), note("B.md", "- [ ] Twee")];
		const { app, reads } = vaultOf(files);
		const cache = new ScanCache();

		await read(cache, app);
		const again = await read(cache, app);

		expect(reads()).toBe(2);
		expect(cache.reused).toBe(2);
		expect(again.map((one) => one.note.path).sort()).toEqual(["A.md", "B.md"]);
	});

	it("re-reads a note whose mtime moved", async () => {
		const files = [note("A.md", "- [ ] Een"), note("B.md", "- [ ] Twee")];
		const { app, reads } = vaultOf(files);
		const cache = new ScanCache();
		await read(cache, app);

		files[0].content = "- [ ] Een\n- [ ] Bijgekomen";
		files[0].stat = { mtime: 2000, size: files[0].content.length };
		const again = await read(cache, app);

		expect(reads()).toBe(3);
		expect(cache.reused).toBe(1);
		expect(again.find((one) => one.note.path === "A.md")?.tasks).toHaveLength(2);
	});

	it("re-reads a note whose size changed, even at the same mtime", async () => {
		// Two writes inside one millisecond is a real thing on a fast disk, and
		// this is the half of the pair that catches it.
		const files = [note("A.md", "- [ ] Een")];
		const { app, reads } = vaultOf(files);
		const cache = new ScanCache();
		await read(cache, app);

		files[0].content = "- [ ] Een andere taak hier";
		files[0].stat = { mtime: 1000, size: files[0].content.length };
		await read(cache, app);

		expect(reads()).toBe(2);
		expect(cache.reused).toBe(0);
	});

	it("hands back the new text, not the old", async () => {
		const files = [note("A.md", "- [ ] Oud")];
		const { app } = vaultOf(files);
		const cache = new ScanCache();
		await read(cache, app);

		files[0].content = "- [ ] Nieuw";
		files[0].stat = { mtime: 2000, size: files[0].content.length };
		const again = await read(cache, app);

		expect(again[0].note.content).toBe("- [ ] Nieuw");
		expect(again[0].tasks[0]?.fields.description).toBe("Nieuw");
	});
});

describe("what a scan must let go of", () => {
	it("drops a note that is no longer in the vault", async () => {
		const files = [note("A.md", "- [ ] Een"), note("B.md", "- [ ] Twee")];
		const { app } = vaultOf(files);
		const cache = new ScanCache();
		await read(cache, app);

		files.pop();
		const again = await read(cache, app);

		expect(again.map((one) => one.note.path)).toEqual(["A.md"]);
	});

	it("treats a rename as a different note", async () => {
		const files = [note("A.md", "- [ ] Een")];
		const { app, reads } = vaultOf(files);
		const cache = new ScanCache();
		await read(cache, app);

		files[0].path = "B.md";
		const again = await read(cache, app);

		expect(reads()).toBe(2);
		expect(again.map((one) => one.note.path)).toEqual(["B.md"]);
	});

	it("forgets everything when told to", async () => {
		// *Rescan the vault* is the command you reach for when the wheel and the
		// vault disagree, so it must not be able to hand back the very outlines
		// that are under suspicion.
		const files = [note("A.md", "- [ ] Een")];
		const { app, reads } = vaultOf(files);
		const cache = new ScanCache();
		await read(cache, app);

		cache.clear();
		await read(cache, app);

		expect(reads()).toBe(2);
		expect(cache.reused).toBe(0);
	});

	it("reads only what is in scope, and returns only that", async () => {
		const files = [note("Werk/A.md", "- [ ] Een"), note("Gezin/B.md", "- [ ] Twee")];
		const { app, reads } = vaultOf(files);
		const cache = new ScanCache();

		const scoped = await read(cache, app, { kind: "folder", path: "Werk" });

		expect(scoped.map((one) => one.note.path)).toEqual(["Werk/A.md"]);
		expect(reads()).toBe(1);
	});

	it("does not let two wheels of different scopes evict each other", async () => {
		// The whole vault in one tab and one folder in the next is the normal way
		// to use this, and they share one cache. Pruning to whichever scope asked
		// last made every refresh throw the other's work away — a cache that is
		// worse than none. What a scope narrows is what a scan *reads*.
		const files = [note("Werk/A.md", "- [ ] Een"), note("Gezin/B.md", "- [ ] Twee")];
		const { app, reads } = vaultOf(files);
		const cache = new ScanCache();

		await read(cache, app); // the vault wheel
		expect(reads()).toBe(2);

		await read(cache, app, { kind: "folder", path: "Werk" }); // the local one
		await read(cache, app); // and back to the vault wheel

		// Four scans in, still two reads: nobody threw anybody's work away.
		expect(reads()).toBe(2);
		expect(cache.reused).toBe(2);
	});
});
