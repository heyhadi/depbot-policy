#!/usr/bin/env node
import { run } from "./cli.ts";

process.exitCode = run(process.argv.slice(2), {
  cwd: process.cwd(),
  stdout: (text) => process.stdout.write(text),
  stderr: (text) => process.stderr.write(text),
});
