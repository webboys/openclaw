import fsSync from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

async function withTempDir<T>(run: (dir: string) => Promise<T>): Promise<T> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-run-node-"));
  try {
    return await run(dir);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

describe("run-node script", () => {
  it.runIf(process.platform !== "win32")(
    "preserves control-ui assets by building with tsdown --no-clean",
    async () => {
      await withTempDir(async (tmp) => {
        const argsPath = path.join(tmp, ".pnpm-args.txt");
        const indexPath = path.join(tmp, "dist", "control-ui", "index.html");

        await fs.mkdir(path.dirname(indexPath), { recursive: true });
        await fs.writeFile(indexPath, "<html>sentinel</html>\n", "utf-8");

        const nodeCalls: string[][] = [];
        const spawn = (cmd: string, args: string[], _options: unknown) => {
          if (cmd === "pnpm") {
            fsSync.writeFileSync(argsPath, args.join(" "), "utf-8");
            if (!args.includes("--no-clean")) {
              fsSync.rmSync(path.join(tmp, "dist", "control-ui"), { recursive: true, force: true });
            }
          }
          if (cmd === process.execPath) {
            nodeCalls.push([cmd, ...args]);
          }
          return {
            on: (event: string, cb: (code: number | null, signal: string | null) => void) => {
              if (event === "exit") {
                queueMicrotask(() => cb(0, null));
              }
              return undefined;
            },
          };
        };

        const { runNodeMain } = await import("../../scripts/run-node.mjs");
        const exitCode = await runNodeMain({
          cwd: tmp,
          args: ["--version"],
          env: {
            ...process.env,
            OPENCLAW_FORCE_BUILD: "1",
            OPENCLAW_RUNNER_LOG: "0",
          },
          spawn,
          execPath: process.execPath,
          platform: process.platform,
        });

        expect(exitCode).toBe(0);
        await expect(fs.readFile(argsPath, "utf-8")).resolves.toContain("exec tsdown --no-clean");
        await expect(fs.readFile(indexPath, "utf-8")).resolves.toContain("sentinel");
        expect(nodeCalls).toEqual([[process.execPath, "openclaw.mjs", "--version"]]);
      });
    },
  );

  it("falls back to corepack pnpm when pnpm is unavailable", async () => {
    const calls: string[] = [];
    const missingPnpmError = Object.assign(new Error("spawn pnpm ENOENT"), { code: "ENOENT" });
    type MockExitCallback = (code: number | null, signal: string | null) => void;
    type MockErrorCallback = (error: Error) => void;
    type MockChildProcess = {
      on: {
        (event: "exit", cb: MockExitCallback): void | undefined;
        (event: "error", cb: MockErrorCallback): void | undefined;
      };
    };

    const spawn = (cmd: string, args: string[], _options: unknown): MockChildProcess => {
      calls.push(`${cmd} ${args.join(" ")}`.trim());

      if (cmd === "pnpm") {
        return {
          on: (event, cb) => {
            if (event === "error") {
              queueMicrotask(() => (cb as MockErrorCallback)(missingPnpmError));
            }
            return undefined;
          },
        };
      }
      if (cmd === "corepack") {
        return {
          on: (event, cb) => {
            if (event === "exit") {
              queueMicrotask(() => (cb as MockExitCallback)(0, null));
            }
            return undefined;
          },
        };
      }
      if (cmd === process.execPath) {
        return {
          on: (event, cb) => {
            if (event === "exit") {
              queueMicrotask(() => (cb as MockExitCallback)(0, null));
            }
            return undefined;
          },
        };
      }
      throw new Error(`unexpected command: ${cmd}`);
    };

    const { runNodeMain } = await import("../../scripts/run-node.mjs");
    const exitCode = await runNodeMain({
      cwd: process.cwd(),
      args: ["--version"],
      env: {
        ...process.env,
        OPENCLAW_FORCE_BUILD: "1",
        OPENCLAW_RUNNER_LOG: "0",
      },
      spawn,
      execPath: process.execPath,
      platform: "linux",
    });

    expect(exitCode).toBe(0);
    expect(calls).toEqual([
      "pnpm exec tsdown --no-clean",
      "corepack pnpm exec tsdown --no-clean",
      `${process.execPath} openclaw.mjs --version`,
    ]);
  });
});
