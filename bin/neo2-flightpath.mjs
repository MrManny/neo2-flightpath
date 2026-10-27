#!/usr/bin/env node
// bin/neo2-flightpath.mjs - launcher shim for the compiled CLI (dist/cli.js).
import { main } from '../dist/cli.js';

await main();
