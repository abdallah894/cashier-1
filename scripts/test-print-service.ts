import { runDrawerOpen, runPrint, type PrintDeps } from "../lib/devices/print-service";
import type { PrinterTransport } from "../lib/devices/transport";
import { drawerPulse } from "../lib/receipts/escpos";

let failures = 0;
function check(name: string, condition: boolean, detail = "") {
  console.log(`${condition ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
  if (!condition) failures++;
}

/** A transport that records what it was sent and can be told to fail. */
function fakeTransport(failWith?: string) {
  const sent: Uint8Array[] = [];
  const transport: PrinterTransport = {
    label: "fake",
    async send(bytes) {
      if (failWith) throw new Error(failWith);
      sent.push(bytes);
    },
    async close() {},
  };
  return { transport, sent };
}

function deps(overrides: Partial<PrintDeps> = {}) {
  const completed: { id: string; ok: boolean; error: string | null }[] = [];
  const base: PrintDeps = {
    async requestJob() {
      return { ok: true, jobId: `job-${completed.length + 1}`, copyNumber: 1 };
    },
    async completeJob(id, ok, error) {
      completed.push({ id, ok, error });
    },
    build: () => Uint8Array.from([1, 2, 3]),
    transport: null,
  };
  return { completed, deps: { ...base, ...overrides } };
}

async function main() {
  // ---- printer works ----
  {
    const t = fakeTransport();
    const d = deps({ transport: t.transport });
    const outcome = await runPrint(d.deps, "original");
    check("a successful print is reported as printed via the printer", outcome.status === "printed" && outcome.via === "printer");
    check("the receipt bytes reach the printer once", t.sent.length === 1 && t.sent[0].length === 3);
    check("the job is completed as ok", d.completed.length === 1 && d.completed[0].ok);
  }

  // ---- printer failure is visible, not silent ----
  {
    const t = fakeTransport("paper jam");
    const d = deps({ transport: t.transport });
    const outcome = await runPrint(d.deps, "original");
    check("a printer failure is reported as failed with its error", outcome.status === "failed" && outcome.error === "paper jam");
    check("the failure is recorded on the job so staff can see it", d.completed.length === 1 && !d.completed[0].ok && d.completed[0].error === "paper jam");
  }

  // ---- retry is a new job; nothing else changes ----
  {
    let jobs = 0;
    let transportFails = true;
    const sent: Uint8Array[] = [];
    const flaky: PrinterTransport = {
      label: "flaky",
      async send(bytes) {
        if (transportFails) throw new Error("offline");
        sent.push(bytes);
      },
      async close() {},
    };
    const completed: boolean[] = [];
    const d: PrintDeps = {
      async requestJob() {
        jobs++;
        return { ok: true, jobId: `job-${jobs}`, copyNumber: 1 };
      },
      async completeJob(_id, ok) {
        completed.push(ok);
      },
      build: () => Uint8Array.from([9]),
      transport: flaky,
    };
    const first = await runPrint(d, "original");
    transportFails = false;
    const second = await runPrint(d, "original");
    check("retrying after a failure prints and is a separate job", first.status === "failed" && second.status === "printed" && jobs === 2);
    check("the failed attempt stays on record as failed", completed.join() === "false,true");
    check("only the retry reached the paper", sent.length === 1);
  }

  // ---- refused by the server (not your sale, reprint without reason...) ----
  {
    const t = fakeTransport();
    const d = deps({
      transport: t.transport,
      async requestJob() {
        return { ok: false, error: "print: not yours" };
      },
    });
    const outcome = await runPrint(d.deps, "reprint", null);
    check("a refused request prints nothing", outcome.status === "failed" && outcome.jobId === null && t.sent.length === 0 && d.completed.length === 0);
  }

  // ---- fallback to the browser print dialog ----
  {
    let opened = 0;
    const d = deps({ browserPrint: () => void opened++ });
    const outcome = await runPrint(d.deps, "original");
    check("with no thermal printer the browser dialog is the fallback", outcome.status === "printed" && outcome.via === "browser" && opened === 1);
    const none = deps();
    const failed = await runPrint(none.deps, "original");
    check("with no printer and no fallback the failure is recorded", failed.status === "failed" && none.completed[0].ok === false);
    const broken = deps({
      browserPrint: () => {
        throw new Error("blocked");
      },
    });
    check("a blocked browser print is recorded as failed", (await runPrint(broken.deps, "original")).status === "failed" && broken.completed[0].ok === false);
  }

  // ---- the build step runs with the server-assigned copy number ----
  {
    const copies: number[] = [];
    const t = fakeTransport();
    const d = deps({
      transport: t.transport,
      async requestJob() {
        return { ok: true, jobId: "job-x", copyNumber: 3 };
      },
      build: (copy) => {
        copies.push(copy);
        return Uint8Array.from([0]);
      },
    });
    await runPrint(d.deps, "reprint", "customer asked");
    check("a reprint is built with the copy number the server assigned", copies[0] === 3);
  }

  // ---- drawer: authorisation first, always ----
  {
    const t = fakeTransport();
    const completed: boolean[] = [];
    const denied = await runDrawerOpen({
      transport: t.transport,
      authorize: async () => ({ ok: false, error: "drawer: manager approval is required" }),
      complete: async (_id, ok) => void completed.push(ok),
    });
    check("a denied authorisation sends no pulse", denied.status === "denied" && t.sent.length === 0 && completed.length === 0);

    const ok = await runDrawerOpen({
      transport: t.transport,
      authorize: async () => ({ ok: true, openingId: "open-1" }),
      complete: async (_id, success) => void completed.push(success),
    });
    check("an authorised opening sends exactly the drawer pulse", ok.status === "opened" && t.sent.length === 1 && Array.from(t.sent[0]).join() === Array.from(drawerPulse()).join());
    check("the opening is reported as completed", completed.join() === "true");

    const broken = fakeTransport("usb error");
    const failedCompleted: { ok: boolean; error: string | null }[] = [];
    const failed = await runDrawerOpen({
      transport: broken.transport,
      authorize: async () => ({ ok: true, openingId: "open-2" }),
      complete: async (_id, success, error) => void failedCompleted.push({ ok: success, error }),
    });
    check("a drawer failure is reported with the error", failed.status === "failed" && failedCompleted[0].ok === false && failedCompleted[0].error === "usb error");

    const noPrinter = await runDrawerOpen({
      transport: null,
      authorize: async () => ({ ok: true, openingId: "open-3" }),
      complete: async (_id, success, error) => void failedCompleted.push({ ok: success, error }),
    });
    check("with no printer the authorised opening is recorded as failed", noPrinter.status === "failed" && failedCompleted[1].ok === false);
  }

  if (failures > 0) process.exit(1);
  console.log("Print service tests pass.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
