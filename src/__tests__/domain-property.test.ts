import { describe, expect, it } from "vitest";
import { domainFromProperty, resolveDomain } from "../parse/domain";
import { buildTree } from "../parse/build-tree";
import { DEFAULT_PARSE_OPTIONS, type NoteInput } from "../model/types";

/**
 * The domain from a front-matter property (BC_E3_S81).
 *
 * The owner asked whether the wheel's structure could come from a Bases table
 * instead of from folders, notes and headings (28 aug 2026). The spike
 * (BC_E3_S80) found that a row in a base *is a file* — so a base can only ever
 * supply the angle, never the radius — and that the load-bearing half of the
 * question is answered far more cheaply: let the angle come from a property the
 * note already carries. No Bases API, no second view host, and the pure layers
 * stay pure.
 *
 * A third source, not a replacement: picking it is how it goes on, picking
 * another is how it goes off, and `folder` stays the default.
 */

const AS_PROPERTY = {
	...DEFAULT_PARSE_OPTIONS,
	domainSource: "property" as const,
	domainProperty: "area",
};

function candidates(frontmatter?: Record<string, unknown>) {
	return {
		notePath: "Notes/One.md",
		frontmatterTags: [],
		taskTags: [],
		frontmatter,
	};
}

describe("reading a domain out of one property", () => {
	it("takes text as it stands, trimmed", () => {
		expect(domainFromProperty({ area: "  Work  " }, "area")).toBe("Work");
	});

	it("writes out a number or a boolean rather than refusing it", () => {
		// Odd as a domain name, but it is what the note says, and deciding we
		// know better is how a wheel starts moving tasks for hidden reasons.
		expect(domainFromProperty({ area: 2026 }, "area")).toBe("2026");
		expect(domainFromProperty({ area: false }, "area")).toBe("false");
	});

	it("refuses a number that names nothing", () => {
		expect(domainFromProperty({ area: NaN }, "area")).toBeNull();
		expect(domainFromProperty({ area: Infinity }, "area")).toBeNull();
	});

	it("takes the first usable entry of a list", () => {
		// A note sits in one wedge: the domain is where the note *is*, not
		// everything it touches. Tag mode is the way to feed several wedges.
		expect(domainFromProperty({ area: ["Work", "Home"] }, "area")).toBe("Work");
		expect(domainFromProperty({ area: ["", " ", "Home"] }, "area")).toBe("Home");
	});

	it("refuses what it cannot read the name out of", () => {
		expect(domainFromProperty({ area: { name: "Work" } }, "area")).toBeNull();
		expect(domainFromProperty({ area: null }, "area")).toBeNull();
		expect(domainFromProperty({ area: "" }, "area")).toBeNull();
		expect(domainFromProperty({ area: [] }, "area")).toBeNull();
	});

	it("says nothing about a note that has no front matter at all", () => {
		expect(domainFromProperty(undefined, "area")).toBeNull();
		expect(domainFromProperty({ other: "Work" }, "area")).toBeNull();
	});

	it("refuses a blank property name instead of matching something", () => {
		expect(domainFromProperty({ "": "Work" }, "  ")).toBeNull();
	});

	it("reads the property name as written, spaces around it aside", () => {
		expect(domainFromProperty({ area: "Work" }, " area ")).toBe("Work");
	});
});

describe("the property source among the other two", () => {
	it("lands a task in the domain its note names", () => {
		expect(resolveDomain(candidates({ area: "Health" }), AS_PROPERTY)).toBe(
			"Health",
		);
	});

	it("falls back rather than dropping a task that names none", () => {
		// Nothing may vanish (§2.3): a note without the property is still work.
		expect(resolveDomain(candidates({}), AS_PROPERTY)).toBe(
			AS_PROPERTY.fallbackDomain,
		);
		expect(resolveDomain(candidates(undefined), AS_PROPERTY)).toBe(
			AS_PROPERTY.fallbackDomain,
		);
	});

	it("leaves the other two sources exactly as they were", () => {
		// The whole shape of the decision: a third source, not a rewrite. A
		// reader who never opens the setting sees no change at all.
		const both = candidates({ area: "Health" });
		expect(resolveDomain(both, DEFAULT_PARSE_OPTIONS)).toBe("Notes");
		expect(DEFAULT_PARSE_OPTIONS.domainSource).toBe("folder");

		const tagged = {
			...candidates({ area: "Health" }),
			taskTags: ["domein/werk"],
		};
		expect(
			resolveDomain(tagged, { ...DEFAULT_PARSE_OPTIONS, domainSource: "tag" }),
		).toBe("werk");
	});

	it("ignores the tags of a note it is not asked about", () => {
		// Property mode is per note and does not consult tags, the way folder
		// mode does not: one source at a time, so the answer is explicable.
		const tagged = { ...candidates({ area: "Health" }), taskTags: ["domein/werk"] };
		expect(resolveDomain(tagged, AS_PROPERTY)).toBe("Health");
	});
});

describe("a whole wheel built on properties", () => {
	function note(path: string, area: string | undefined, task: string): NoteInput {
		return {
			path,
			content: `- [ ] ${task}`,
			frontmatter: area === undefined ? {} : { area },
		};
	}

	const NOTES = [
		note("Inbox/One.md", "Work", "call the client"),
		note("Inbox/Two.md", "Home", "fix the tap"),
		note("Archive/Three.md", "Work", "write the summary"),
		note("Archive/Four.md", undefined, "sort this out"),
	];

	it("groups by what the notes say, not by where they are filed", () => {
		// All four sit in two folders; the properties cut across both. That
		// crossing is the whole point of the setting.
		const tree = buildTree(NOTES, AS_PROPERTY);
		expect([...tree.domains].sort()).toEqual([
			"Home",
			AS_PROPERTY.fallbackDomain,
			"Work",
		].sort());
	});

	it("keeps every task, wherever its domain came from", () => {
		const byFolder = buildTree(NOTES, DEFAULT_PARSE_OPTIONS);
		const byProperty = buildTree(NOTES, AS_PROPERTY);
		expect(byProperty.root.shownTaskCount).toBe(byFolder.root.shownTaskCount);
		expect(byProperty.root.shownTaskCount).toBe(4);
	});

	it("puts two notes from different folders under one wedge", () => {
		const tree = buildTree(NOTES, AS_PROPERTY);
		const work = tree.root.children.find((child) => child.domain === "Work");
		expect(work?.shownTaskCount).toBe(2);
	});
});
