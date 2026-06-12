#!/usr/bin/env bun
/**
 * Thin wrapper: dual-tab title-watch test via tab-pool orchestrator.
 *
 * Usage:
 *   bun notion/scripts/test-dual-tab-title-watch.mjs
 *   bun notion/scripts/test-dual-tab-title-watch.mjs --full
 */
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const poolScript = join(__dirname, "test-tab-pool-title-watch.mjs");
const args = process.argv.slice(2);
const argv = args.some((a) => a === "--poolSize") ? args : ["--poolSize", "2", ...args];
const result = spawnSync("bun", [poolScript, ...argv], { stdio: "inherit" });
process.exit(result.status ?? 1);
