# bea-l

bea-l is a local Rust CLI and VSCode companion for capturing current editor/build evidence into a small packet you can paste into an AI coding chat.

It is designed for one simple job: show the current local coding state clearly before asking an assistant for help.

## What it does

- Reads local editor/build evidence supplied by the CLI or VSCode extension.
- Produces a compact generic AI packet.
- Helps you paste cleaner context into an AI coding chat.
- Runs locally.
- Pairs with screenshots when the visible state matters.

Example packet:

```text
BEA-L BASIC PACKET
boundary=local evidence only; no source mutation; no model call
editor=clean errors=0 warnings=0
build=go_clean tests=53 failed=0
visual=attach screenshot if relevant
next=paste this with your request
```

## What it does not do

bea-l does not call model APIs, upload files, mutate source files, act as an agent, or make code changes for you.

It also does not provide comparison intelligence, cloud processing, or paid analysis features.

## CLI

```sh
bea-l version
bea-l inspect
bea-l packet
```

`bea-l packet` prints only the compact generic packet.

## VSCode

The VSCode companion exposes:

- `bea-l: Inspect Workbench Evidence`
- `bea-l: Copy Basic Packet`
- `bea-l: Save Screenshot Snapshot`

`Copy Basic Packet` copies only the compact packet so you can paste it into your AI coding chat.

`Save Screenshot Snapshot` asks macOS to save a screenshot into your configured snapshot folder. Review the image before sharing it.

## Screenshots

A screenshot shows what you see. The bea-l packet shows local editor/build evidence. Use both when asking an AI coding assistant for help.

The default screenshot folder is:

```text
~/Downloads/bea-l-snapshots
```

You can change it in the VSCode setting:

```text
nscBeak.snapshotFolder
```

## Privacy and local boundary

bea-l is local-first. It does not upload your project, call an AI service, or edit your source files.

Screenshots are saved locally. Review any screenshot before sharing it with an AI chat or another person.

bea-l reports the local evidence it is given. A clean packet is useful context, not proof that a whole project is correct.

## Status

bea-l is a public free local snapshot tool from NSC Labs.

More advanced paid tooling may come later, but it is not part of this Free release.
