---
"neo2-flightpath": patch
---

Every CLI option's default now lives in one table (`CONFIG_OPTIONS` in `src/config.ts`), which the command-line parser, the help text and the config-file layer all read from — adding an option is one edit instead of three. The `--out-dir` default is documented consistently as the `out` folder (the README previously said the output landed beside the source video), and the CLI help text names the offending flag when a value does not fit its option.
