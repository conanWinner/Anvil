# CLI Setup Guide

Steps to install and configure the Anvil CLI. Always run these first.

## 1. Install Dependencies

```bash
cd <anvil-repo> && bun install
```

If `bun` is not installed, direct the user to https://bun.sh and stop.

## 2. Link the CLI Globally

```bash
cd <anvil-repo>/packages/cli && bun link
```

This makes `anvil` available as a global command from any directory.

## 3. Verify Installation

```bash
anvil version
```

Should print the version number. If it fails, re-run step 2 and check that Bun's global bin directory is in `$PATH`.

## 4. Authenticate Claude

Check if Claude Code is installed:

```bash
which claude
```

If not installed, direct the user to install Claude Code and stop.

If installed but not authenticated, run:

```bash
claude /login
```

This stores credentials globally — no `.env` or API key needed for CLI usage.

## Notes

- **No `.env` required**: CLI-only usage doesn't need any environment variables. If no API keys are in the environment, the CLI auto-defaults to global Claude auth from `claude /login`.
- **Database**: SQLite auto-creates at `~/.anvil/anvil.db` — no setup needed for CLI-only use.
- **Config**: `~/.anvil/config.yaml` is auto-created on first run with sensible defaults. Per-repo config can be added at `<repo>/.anvil/config.yaml` to override the AI assistant or configure command folders. Neither file needs manual creation for basic usage.
