import { beforeEach, describe, expect, it } from "vitest";
import { deferWrites, type Schedule } from "../model/deferred";

/**
 * Collecting state changes on their way to disk (BC_E3_S45, audit P2).
 *
 * Tested with a clock that only moves when told, because the whole claim is
 * about *counting*: asked sixty times, wrote once. A real clock could only show
 * that it eventually writes, which was never in doubt.
 */

/** A clock that moves by hand, with one timer at a time — all this uses. */
function clock() {
	let now = 0;
	let pending: { run: () => void; at: number } | null = null;

	const schedule: Schedule = (run, after) => {
		pending = { run, at: now + after };
		return () => {
			pending = null;
		};
	};

	return {
		schedule,
		/** Move time on, run whatever fell due, and let the writes settle. */
		async pass(ms: number): Promise<void> {
			now += ms;
			if (pending !== null && pending.at <= now) {
				const due = pending.run;
				pending = null;
				due();
			}
			// The write is chained onto a promise, so it lands a microtask after
			// the timer rather than inside it.
			for (let i = 0; i < 5; i++) await Promise.resolve();
		},
	};
}

/** A write that records how often it ran, and can be made to fail once. */
function recorder() {
	const runs: number[] = [];
	let fail: Error | null = null;

	return {
		runs,
		failWith(error: Error): void {
			fail = error;
		},
		write: (): Promise<void> => {
			runs.push(runs.length);
			if (fail !== null) {
				const error = fail;
				fail = null;
				return Promise.reject(error);
			}
			return Promise.resolve();
		},
	};
}

let time: ReturnType<typeof clock>;
let saves: ReturnType<typeof recorder>;

const collecting = (wait = 500, onFail?: (error: unknown) => void) =>
	deferWrites(saves.write, { wait, schedule: time.schedule, onFail });

beforeEach(() => {
	time = clock();
	saves = recorder();
});

describe("collecting writes", () => {
	it("writes nothing until the asking stops", async () => {
		const writes = collecting();

		writes.soon();
		await time.pass(499);
		expect(saves.runs).toHaveLength(0);

		await time.pass(1);
		expect(saves.runs).toHaveLength(1);
	});

	it("costs one write for a burst of asks", async () => {
		const writes = collecting();

		// A pinch: sixty frames a second, for a second.
		for (let frame = 0; frame < 60; frame++) {
			writes.soon();
			await time.pass(16);
		}
		expect(saves.runs).toHaveLength(0);

		await time.pass(500);
		expect(saves.runs).toHaveLength(1);
	});

	it("writes once per pause, not once per ask", async () => {
		const writes = collecting();

		// A round: a stop every 800 ms. Each is far enough from the last to be
		// its own write, so the wheel is never behind for long.
		for (let stop = 0; stop < 20; stop++) {
			writes.soon();
			await time.pass(800);
		}

		expect(saves.runs).toHaveLength(20);
	});

	it("writes what is owed when asked to write now", async () => {
		const writes = collecting();

		writes.soon();
		expect(writes.owed()).toBe(true);

		await writes.now();
		expect(saves.runs).toHaveLength(1);
		expect(writes.owed()).toBe(false);

		// The timer it cancelled does not then fire a second one.
		await time.pass(1000);
		expect(saves.runs).toHaveLength(1);
	});

	it("costs nothing to write now when nothing is owed", async () => {
		const writes = collecting();

		await writes.now();
		await writes.now();

		expect(saves.runs).toHaveLength(0);
	});

	it("keeps going after a write fails", async () => {
		const heard: unknown[] = [];
		const writes = collecting(500, (error) => heard.push(error));

		saves.failWith(new Error("the disk said no"));
		writes.soon();
		await time.pass(500);
		expect(heard).toHaveLength(1);

		// The point: one unlucky write must not stop every later one.
		writes.soon();
		await time.pass(500);
		expect(saves.runs).toHaveLength(2);
		expect(heard).toHaveLength(1);
	});

	it("never has two writes in flight at once", async () => {
		let running = 0;
		let most = 0;
		let release: (() => void) | null = null;

		const writes = deferWrites(
			() => {
				running++;
				most = Math.max(most, running);
				return new Promise<void>((resolve) => {
					release = (): void => {
						running--;
						resolve();
					};
				});
			},
			{ wait: 10, schedule: time.schedule },
		);

		writes.soon();
		await time.pass(10);
		// Asked again while the first write is still in flight.
		writes.soon();
		await time.pass(10);

		expect(most).toBe(1);

		const go = release as (() => void) | null;
		go?.();
		await time.pass(0);
		expect(most).toBe(1);
	});
});
