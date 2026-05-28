import * as vscode from "vscode";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { execFile } from "child_process";
import type { ExecFileException } from "child_process";

const OUTPUT = vscode.window.createOutputChannel("bea-l");

type BeakSeverity = "error" | "warning" | "info" | "hint" | "unknown";

type BeakDiagnosticEntry = {
  severity: BeakSeverity;
  source: string | null;
  code: string | null;
  message: string;
  range: {
    start_line: number;
    start_character: number;
    end_line: number;
    end_character: number;
  };
};

type BeakDiagnosticFile = {
  path: string;
  language: string | null;
  entries: BeakDiagnosticEntry[];
};

type BuildEvidenceStatus = {
  exit_code: number | null;
  success: boolean;
};

type BuildEvidenceRaw = {
  stdout: string;
  stderr: string;
  stdout_truncated: boolean;
  stderr_truncated: boolean;
};

type BuildEvidencePacket = {
  schema: "nsc.beak.build_evidence.v0";
  source: {
    producer: "vscode";
    kind: "build_evidence";
    tool: string;
    tool_args: string[];
    capture: "plain_text_wrapped" | "structured_jsonl";
  };
  workspace: {
    name: string | null;
    root: string | null;
  };
  status: BuildEvidenceStatus;
  caps: {
    max_stdout_chars: number;
    max_stderr_chars: number;
  };
  raw: BuildEvidenceRaw;
  truncated: {
    stdout: boolean;
    stderr: boolean;
  };
};

function severityName(severity: vscode.DiagnosticSeverity): BeakSeverity {
  switch (severity) {
    case vscode.DiagnosticSeverity.Error:
      return "error";
    case vscode.DiagnosticSeverity.Warning:
      return "warning";
    case vscode.DiagnosticSeverity.Information:
      return "info";
    case vscode.DiagnosticSeverity.Hint:
      return "hint";
    default:
      return "unknown";
  }
}

function capText(value: string, maxChars: number): { text: string; truncated: boolean } {
  if (value.length <= maxChars) {
    return { text: value, truncated: false };
  }

  return { text: value.slice(0, maxChars), truncated: true };
}

function relativeWorkspacePath(uri: vscode.Uri, workspaceRoot: string | undefined): string {
  if (!workspaceRoot) {
    return uri.fsPath;
  }

  const rel = path.relative(workspaceRoot, uri.fsPath);
  if (rel === "" || rel.startsWith("..") || path.isAbsolute(rel)) {
    return uri.fsPath;
  }

  return rel;
}

function languageForUri(uri: vscode.Uri): string | undefined {
  const doc = vscode.workspace.textDocuments.find(
    (candidate: vscode.TextDocument) => candidate.uri.toString() === uri.toString()
  );
  return doc?.languageId;
}

async function writeDiagnosticsFile(): Promise<string> {
  const maxFiles = 40;
  const maxEntries = 120;
  const maxEntriesPerFile = 20;
  const maxMessageChars = 500;

  const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
  const workspaceRoot = workspaceFolder?.uri.fsPath;

  const allDiagnostics = vscode.languages.getDiagnostics();

  let usedFiles = 0;
  let usedEntries = 0;
  let truncatedFiles = false;
  let truncatedEntries = false;
  let truncatedMessages = false;

  const diagnostics: BeakDiagnosticFile[] = [];

  for (const [uri, entries] of allDiagnostics) {
    if (entries.length === 0) {
      continue;
    }

    if (workspaceRoot) {
      const rel = path.relative(workspaceRoot, uri.fsPath);
      if (rel.startsWith("..") || path.isAbsolute(rel)) {
        continue;
      }
    }

    if (usedFiles >= maxFiles) {
      truncatedFiles = true;
      break;
    }

    const sortedEntries = [...entries].sort((a: vscode.Diagnostic, b: vscode.Diagnostic) => {
      if (a.severity !== b.severity) {
        return a.severity - b.severity;
      }

      return a.range.start.line - b.range.start.line;
    });

    const cappedEntries: BeakDiagnosticEntry[] = [];

    for (const entry of sortedEntries) {
      if (usedEntries >= maxEntries) {
        truncatedEntries = true;
        break;
      }

      if (cappedEntries.length >= maxEntriesPerFile) {
        truncatedEntries = true;
        break;
      }

      const capped = capText(entry.message, maxMessageChars);
      truncatedMessages = truncatedMessages || capped.truncated;

      cappedEntries.push({
        severity: severityName(entry.severity),
        source: entry.source ?? null,
        code: entry.code === undefined ? null : String(entry.code),
        message: capped.text,
        range: {
          start_line: entry.range.start.line,
          start_character: entry.range.start.character,
          end_line: entry.range.end.line,
          end_character: entry.range.end.character
        }
      });

      usedEntries += 1;
    }

    if (cappedEntries.length === 0) {
      continue;
    }

    diagnostics.push({
      path: relativeWorkspacePath(uri, workspaceRoot),
      language: languageForUri(uri) ?? null,
      entries: cappedEntries
    });

    usedFiles += 1;
  }

  const packet = {
    schema: "nsc.beak.diagnostics.v0",
    source: {
      producer: "vscode",
      kind: "workbench_diagnostics"
    },
    workspace: {
      name: workspaceFolder?.name ?? null,
      root: workspaceRoot ?? null
    },
    caps: {
      max_files: maxFiles,
      max_entries: maxEntries,
      max_entries_per_file: maxEntriesPerFile,
      max_message_chars: maxMessageChars
    },
    diagnostics,
    truncated: {
      files: truncatedFiles,
      entries: truncatedEntries,
      messages: truncatedMessages
    }
  };

  const filePath = path.join(os.tmpdir(), `nsc-beak-diagnostics-${Date.now()}.json`);
  await fs.promises.writeFile(filePath, JSON.stringify(packet, null, 2), "utf8");
  return filePath;
}

function execFileCaptured(
  command: string,
  args: string[],
  cwd: string | undefined
): Promise<{ stdout: string; stderr: string; error: ExecFileException | null }> {
  return new Promise((resolve) => {
    execFile(command, args, { cwd, maxBuffer: 1024 * 1024 }, (error: ExecFileException | null, stdout: string, stderr: string) => {
      resolve({ stdout, stderr, error });
    });
  });
}

function stripAnsi(value: string): string {
  return value.replace(/\x1b\[[0-9;]*m/g, "");
}

function capOutput(value: string, maxChars: number): { value: string; truncated: boolean } {
  const clean = stripAnsi(value);

  if (clean.length <= maxChars) {
    return { value: clean, truncated: false };
  }

  return { value: clean.slice(0, maxChars), truncated: true };
}

function exitCodeFromError(error: ExecFileException | null): number | null {
  if (error === null) {
    return 0;
  }

  return error.code === undefined ? null : Number(error.code);
}

function runBeaL(binaryPath: string, args: string[], cwd: string | undefined): void {
  execFile(binaryPath, args, { cwd }, (error: Error | null, stdout: string, stderr: string) => {
    if (stdout.trim().length > 0) {
      OUTPUT.appendLine(stdout);
    }

    if (stderr.trim().length > 0) {
      OUTPUT.appendLine("");
      OUTPUT.appendLine("stderr:");
      OUTPUT.appendLine(stderr);
    }

    if (error) {
      OUTPUT.appendLine("");
      OUTPUT.appendLine(`bea-l command failed: ${error.message}`);
    }
  });
}

function runBeaLCaptured(
  binaryPath: string,
  args: string[],
  cwd: string | undefined
): Promise<{ stdout: string; stderr: string; error: ExecFileException | null }> {
  return new Promise((resolve) => {
    execFile(binaryPath, args, { cwd }, (error: ExecFileException | null, stdout: string, stderr: string) => {
      resolve({ stdout, stderr, error });
    });
  });
}

async function writeTypeScriptBuildEvidenceFile(extensionRoot: string): Promise<string> {
  const maxStdoutChars = 200000;
  const maxStderrChars = 200000;
  const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
  const workspaceRoot = workspaceFolder?.uri.fsPath;

  const tool = "npx";
  const toolArgs = ["--no-install", "tsc", "-p", extensionRoot, "--noEmit", "--pretty", "false"];
  const result = await execFileCaptured(tool, toolArgs, extensionRoot);

  const stdout = capOutput(result.stdout, maxStdoutChars);
  const stderr = capOutput(result.stderr, maxStderrChars);

  const packet: BuildEvidencePacket = {
    schema: "nsc.beak.build_evidence.v0",
    source: {
      producer: "vscode",
      kind: "build_evidence",
      tool,
      tool_args: toolArgs,
      capture: "plain_text_wrapped"
    },
    workspace: {
      name: workspaceFolder?.name ?? null,
      root: workspaceRoot ?? null
    },
    status: {
      exit_code: exitCodeFromError(result.error),
      success: result.error === null
    },
    caps: {
      max_stdout_chars: maxStdoutChars,
      max_stderr_chars: maxStderrChars
    },
    raw: {
      stdout: stdout.value,
      stderr: stderr.value,
      stdout_truncated: stdout.truncated,
      stderr_truncated: stderr.truncated
    },
    truncated: {
      stdout: stdout.truncated,
      stderr: stderr.truncated
    }
  };

  const filePath = path.join(os.tmpdir(), `nsc-beak-build-typescript-${Date.now()}.json`);
  await fs.promises.writeFile(filePath, JSON.stringify(packet, null, 2), "utf8");
  return filePath;
}

async function writeGoTestEvidenceFile(): Promise<string> {
  const maxStdoutChars = 200000;
  const maxStderrChars = 200000;
  const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
  const workspaceRoot = workspaceFolder?.uri.fsPath;

  if (!workspaceRoot) {
    throw new Error("open a workspace folder before collecting Go test evidence");
  }

  const tool = "go";
  const toolArgs = ["test", "-json", "./..."];
  const result = await execFileCaptured(tool, toolArgs, workspaceRoot);

  const stdout = capOutput(result.stdout, maxStdoutChars);
  const stderr = capOutput(result.stderr, maxStderrChars);

  const packet: BuildEvidencePacket = {
    schema: "nsc.beak.build_evidence.v0",
    source: {
      producer: "vscode",
      kind: "build_evidence",
      tool,
      tool_args: toolArgs,
      capture: "structured_jsonl"
    },
    workspace: {
      name: workspaceFolder?.name ?? null,
      root: workspaceRoot ?? null
    },
    status: {
      exit_code: exitCodeFromError(result.error),
      success: result.error === null
    },
    caps: {
      max_stdout_chars: maxStdoutChars,
      max_stderr_chars: maxStderrChars
    },
    raw: {
      stdout: stdout.value,
      stderr: stderr.value,
      stdout_truncated: stdout.truncated,
      stderr_truncated: stderr.truncated
    },
    truncated: {
      stdout: stdout.truncated,
      stderr: stderr.truncated
    }
  };

  const filePath = path.join(os.tmpdir(), `nsc-beak-build-go-test-${Date.now()}.json`);
  await fs.promises.writeFile(filePath, JSON.stringify(packet, null, 2), "utf8");
  return filePath;
}

function configuredBinaryPath(): string {
  return vscode.workspace.getConfiguration("nscBeak").get<string>("binaryPath") || "bea-l";
}

type BuildEvidenceMode = "typescript" | "go-test" | "none";

function configuredBuildEvidenceMode(): BuildEvidenceMode {
  const value = vscode.workspace.getConfiguration("nscBeak").get<string>("buildEvidenceCommand") || "go-test";

  if (value === "typescript" || value === "go-test" || value === "none") {
    return value;
  }

  return "go-test";
}

function configuredSnapshotFolder(): string {
  const configured = vscode.workspace.getConfiguration("nscBeak").get<string>("snapshotFolder") || "";
  if (configured.trim().length > 0) {
    return configured;
  }

  return path.join(os.homedir(), "Downloads", "bea-l-snapshots");
}

function timestampForFilename(): string {
  return new Date()
    .toISOString()
    .replace(/[:.]/g, "-")
    .replace("T", "-")
    .replace("Z", "");
}

async function writeConfiguredBuildEvidenceFile(context: vscode.ExtensionContext): Promise<string | undefined> {
  switch (configuredBuildEvidenceMode()) {
    case "typescript":
      return writeTypeScriptBuildEvidenceFile(context.extensionPath);
    case "go-test":
      return writeGoTestEvidenceFile();
    case "none":
      return undefined;
  }
}

function workspaceRoot(): string | undefined {
  return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
}

export function activate(context: vscode.ExtensionContext) {
  const inspectWorkbenchEvidence = vscode.commands.registerCommand("nscBeak.inspectWorkbenchEvidence", async () => {
    OUTPUT.clear();
    OUTPUT.show(true);

    try {
      await writeDiagnosticsFile();
      await writeConfiguredBuildEvidenceFile(context);
      const binaryPath = configuredBinaryPath();

      OUTPUT.appendLine("Running bea-l...");
      OUTPUT.appendLine("Boundary: local evidence only; no source mutation; no model call; no upload");
      OUTPUT.appendLine(`Build evidence mode: ${configuredBuildEvidenceMode()}`);
      OUTPUT.appendLine("");

      runBeaL(binaryPath, ["inspect"], workspaceRoot());
    } catch (err) {
      OUTPUT.appendLine(`bea-l workbench evidence capture failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  });

  const copyBasicPacket = vscode.commands.registerCommand("nscBeak.copyBasicPacket", async () => {
    OUTPUT.clear();

    try {
      await writeDiagnosticsFile();
      await writeConfiguredBuildEvidenceFile(context);
      const binaryPath = configuredBinaryPath();
      const result = await runBeaLCaptured(binaryPath, ["packet"], workspaceRoot());

      if (result.error) {
        OUTPUT.show(true);
        OUTPUT.appendLine(`bea-l packet failed: ${result.error.message}`);
        if (result.stderr.trim().length > 0) {
          OUTPUT.appendLine("");
          OUTPUT.appendLine("stderr:");
          OUTPUT.appendLine(result.stderr);
        }
        return;
      }

      const packet = result.stdout.trim();
      await vscode.env.clipboard.writeText(packet);
      vscode.window.showInformationMessage("bea-l basic packet copied.");
    } catch (err) {
      OUTPUT.show(true);
      OUTPUT.appendLine(`bea-l copy basic packet failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  });

  const saveScreenshotSnapshot = vscode.commands.registerCommand("nscBeak.saveScreenshotSnapshot", async () => {
    OUTPUT.clear();

    if (process.platform !== "darwin") {
      vscode.window.showWarningMessage("bea-l screenshot snapshots are currently supported on macOS only.");
      return;
    }

    const choice = await vscode.window.showWarningMessage(
      "bea-l will ask macOS to save a screenshot to your configured snapshot folder. Review the image before sharing it.",
      { modal: true },
      "Continue"
    );

    if (choice !== "Continue") {
      return;
    }

    try {
      const folder = configuredSnapshotFolder();
      await fs.promises.mkdir(folder, { recursive: true });

      const screenshotPath = path.join(folder, `bea-l-${timestampForFilename()}.png`);

      execFile("screencapture", ["-i", screenshotPath], (error: Error | null, _stdout: string, stderr: string) => {
        if (error) {
          OUTPUT.show(true);
          OUTPUT.appendLine(`bea-l screenshot failed: ${error.message}`);
          if (stderr.trim().length > 0) {
            OUTPUT.appendLine("");
            OUTPUT.appendLine("stderr:");
            OUTPUT.appendLine(stderr);
          }
          return;
        }

        vscode.window.showInformationMessage(`bea-l screenshot saved: ${screenshotPath}`);
      });
    } catch (err) {
      OUTPUT.show(true);
      OUTPUT.appendLine(`bea-l screenshot snapshot failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  });

  context.subscriptions.push(inspectWorkbenchEvidence, copyBasicPacket, saveScreenshotSnapshot);
}

export function deactivate() {}
