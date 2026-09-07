import { describe, expect, it, vi } from "vitest";
import {
	Diagnostics,
	type DiagnosticsHost,
	readingOf,
	TRACE_LINES,
} from "../view/diagnostics";
import { DEFAULT_SETTINGS } from "../settings";

/**
 * The window onto a device we cannot reach (BC_E3_S162).
 *
 * All of this used to be private methods on an `ItemView`, which is to say
 * unreachable: two of the audit's findings of 6 sep 2026 sat in exactly such
 * code and no test could have caught either. What still needs a browser is the
 * panel and the measuring; what does not is the buffer, the guard around a
 * drawing step, and the shape of a reading — and those now have a way in.
 */

function harness(diagnostics = false): Diagnostics {
	const settings = structuredClone(DEFAULT_SETTINGS);
	settings.diagnostics = diagnostics;

	const host: DiagnosticsHost = {
		settings,
		version: "0.2.2",
		scope: () => "Task wheel",
		// No pane: every method here either does not touch it or checks first.
		contentEl: null as unknown as HTMLElement,
		own: () => undefined,
		onDom: () => undefined,
		onWindow: () => undefined,
	};

	return new Diagnostics(host);
}

describe("the trace buffer", () => {
	it("keeps the lines whether or not the panel is on", () => {
		// The buffer keeps them and the panel merely shows them, so switching
		// diagnostics on *after* the thing you were trying to catch still gives
		// you the trace that contains it. An instrument that is only running
		// when you remembered to arm it is not an instrument.
		const off = harness(false);
		off.line("draw: 40 items");

		expect(off.lines()).toEqual(["draw: 40 items"]);
	});

	it("drops the oldest rather than growing without end", () => {
		const diag = harness(true);
		for (let i = 0; i < TRACE_LINES + 5; i++) diag.line(`line ${i}`);

		expect(diag.lines()).toHaveLength(TRACE_LINES);
		expect(diag.lines()[0]).toBe("line 5");
		expect(diag.lines()[TRACE_LINES - 1]).toBe(`line ${TRACE_LINES + 4}`);
	});
});

describe("safely", () => {
	it("lets the other steps finish when one throws", () => {
		// A view that half-renders and says nothing is the worst outcome on a
		// device the developer cannot reach: the reader sees something, so it
		// looks deliberate.
		const diag = harness(true);
		const after = vi.fn();
		const quiet = vi.spyOn(console, "error").mockImplementation(() => undefined);

		diag.safely("drawing the wheel", () => {
			throw new Error("no room");
		});
		diag.safely("drawing the card", after);

		expect(after).toHaveBeenCalled();
		quiet.mockRestore();
	});

	it("writes the failure into the trace, named by its step", () => {
		const diag = harness(true);
		const quiet = vi.spyOn(console, "error").mockImplementation(() => undefined);

		diag.safely("drawing the key", () => {
			throw new Error("no room");
		});

		expect(diag.lines()).toEqual(["FAILED drawing the key: no room"]);
		quiet.mockRestore();
	});

	it("says something even when what was thrown is not an Error", () => {
		// A device can throw a string, and the point of this guard is that the
		// reader hears about it either way.
		const diag = harness(true);
		const quiet = vi.spyOn(console, "error").mockImplementation(() => undefined);

		diag.safely("drawing the sweep", () => {
			// eslint-disable-next-line @typescript-eslint/only-throw-error -- the point of the test is what a device throws that is not an Error
			throw "nope";
		});

		expect(diag.lines()[0]).toBe("FAILED drawing the sweep: nope");
		quiet.mockRestore();
	});
});

describe("readingOf", () => {
	const BASE = {
		innerHeight: 800,
		visual: { height: 500.4, offsetTop: 12.6 },
		box: { top: 60.2, height: 700.8 },
		scroll: { top: 0, height: 700 },
		padBottom: "48px",
		safe: "34px",
		bottomBar: "48px",
		focused: "textarea.task-wheel-card-rename",
	};

	it("reads as the line the owner has learned to read", () => {
		// Unchanged to the character by the split: a trace someone reads by eye
		// is not something a refactor gets to reword.
		expect(readingOf(BASE)).toBe(
			"window 800 · visual 500@13 · pane 60+701 · scroll 0/700" +
				" · pad-bottom 48px · safe-area 34px · bottom-bar 48px" +
				" · focus textarea.task-wheel-card-rename",
		);
	});

	it("leaves the visual viewport out when the device has none", () => {
		expect(readingOf({ ...BASE, visual: null })).not.toContain("visual");
	});

	it("says 'unset' rather than nothing for a variable that is not set", () => {
		// An empty gap in the middle of a line reads as a bug in the instrument.
		const line = readingOf({ ...BASE, safe: "", bottomBar: "" });
		expect(line).toContain("safe-area unset");
		expect(line).toContain("bottom-bar unset");
	});
});
