import { describe, expect, it } from "vitest";
import { parentCandidates } from "../view/task-picker";

/**
 * Which tasks may become the parent (BC_E3_S19).
 *
 * The picker is where the dangerous refusal is enforced in practice: hanging a
 * branch under its own descendant would take both of them out of the note.
 * `moveUnderTask` refuses it too — belt and braces — but the reader should
 * never be offered it in the first place.
 */

const lines = [
	"## Tuin", // 0
	"- [ ] Haag aanpakken", // 1
	"    - [ ] Gereedschap halen", // 2
	"        - [ ] Slijpsteen zoeken", // 3
	"- [ ] Takken afvoeren", // 4
	"Wat losse tekst.", // 5
	"## Binnen", // 6
	"- [ ] Lamp vervangen", // 7
];

const linesOf = (index: number): number[] =>
	parentCandidates(lines, index).map((choice) => choice.line);

describe("parentCandidates", () => {
	it("offers every other task in the note", () => {
		expect(linesOf(4)).toEqual([1, 2, 3, 7]);
	});

	it("never offers the task itself", () => {
		expect(linesOf(1)).not.toContain(1);
	});

	it("never offers anything inside it — that would lose both", () => {
		expect(linesOf(1)).toEqual([4, 7]);
	});

	it("offers nothing when the note holds one task and its own children", () => {
		expect(parentCandidates(["- [ ] Alleen", "    - [ ] Kind"], 0)).toEqual([]);
	});

	it("skips headings and prose — only a task can be a parent", () => {
		expect(linesOf(4)).not.toContain(0);
		expect(linesOf(4)).not.toContain(5);
		expect(linesOf(4)).not.toContain(6);
	});

	it("carries the heading each candidate sits under, to tell look-alikes apart", () => {
		const choices = parentCandidates(lines, 4);
		expect(choices.find((c) => c.line === 7)?.path).toEqual(["Binnen"]);
		expect(choices.find((c) => c.line === 1)?.path).toEqual(["Tuin"]);
	});

	it("carries how deep each one is, so the list reads as an outline", () => {
		const choices = parentCandidates(lines, 4);
		expect(choices.find((c) => c.line === 1)?.depth).toBe(0);
		expect(choices.find((c) => c.line === 2)?.depth).toBe(4);
		expect(choices.find((c) => c.line === 3)?.depth).toBe(8);
	});
});
