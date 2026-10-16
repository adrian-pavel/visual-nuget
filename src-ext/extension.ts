import * as vscode from 'vscode';
import * as path from 'path';
import { Solution } from '../src-common/models/project';
import * as quickPick from './services/quick-pick';

import UiPanel from './ui-panel';
import SessionPackageCache from './services/session-package-cache';
import SessionSolutionCache from './services/session-solution-cache';

const solutionInventoryWatchPattern =
  '**/{*.sln,*.slnx,*.csproj,*.vbproj,*.fsproj,*.props,*.targets,*.config,*.Config,packages.config,packages.lock.json,project.assets.json,global.json}';

function isSolutionInputWatched(solution: Solution): boolean {
  const solutionPaths = [
    solution.fsPath,
    ...solution.unsupportedProjects,
    ...solution.projects.flatMap((project) => [
      project.fsPath,
      ...project.packages.flatMap((packageItem) => [
        packageItem.versionFilePath,
        ...(packageItem.targetFrameworkVersions ?? []).map((version) => version.versionFilePath),
      ]),
    ]),
  ].filter((filePath): filePath is string => filePath !== undefined);

  return (
    solutionPaths.length > 0 &&
    solutionPaths.every((filePath) => vscode.workspace.getWorkspaceFolder(vscode.Uri.file(filePath)) !== undefined)
  );
}

export function activate(context: vscode.ExtensionContext) {
  const diagnosticOutput = vscode.window.createOutputChannel('Visual NuGet');
  const sessionPackageCache = new SessionPackageCache();
  const sessionSolutionCache = new SessionSolutionCache(isSolutionInputWatched);
  const invalidateSolutionCache = (reason: string, uri?: vscode.Uri) => {
    if (uri && ['.sln', '.slnx'].includes(path.extname(uri.fsPath).toLowerCase())) {
      const invalidated = sessionSolutionCache.invalidate(uri.fsPath);
      diagnosticOutput.appendLine(
        `solution-inventory FILE_EVENT, reason=${reason}, filePath=${uri.fsPath}, invalidated=${invalidated}`
      );
      return;
    }

    const cachedEntryCount = sessionSolutionCache.entryCount;
    sessionSolutionCache.clear();
    if (cachedEntryCount > 0) {
      const filePath = uri ? `, filePath=${uri.fsPath}` : '';
      diagnosticOutput.appendLine(
        `solution-inventory INVALIDATED, reason=${reason}${filePath}, entries=${cachedEntryCount}`
      );
    }
  };
  const solutionInputWatcher = vscode.workspace.createFileSystemWatcher(solutionInventoryWatchPattern);
  context.subscriptions.push(
    diagnosticOutput,
    solutionInputWatcher,
    solutionInputWatcher.onDidCreate((uri) => invalidateSolutionCache('watched-file-created', uri)),
    solutionInputWatcher.onDidChange((uri) => invalidateSolutionCache('watched-file-changed', uri)),
    solutionInputWatcher.onDidDelete((uri) => invalidateSolutionCache('watched-file-deleted', uri)),
    vscode.workspace.onDidChangeWorkspaceFolders(() => invalidateSolutionCache('workspace-folders-changed')),
    {
      dispose: () => {
        sessionPackageCache.clear();
        sessionSolutionCache.clear();
      },
    }
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('visualnuget.managePackages', (uri: vscode.Uri) => {
      if (uri) {
        UiPanel.createOrShow(context.extensionPath, uri, sessionPackageCache, sessionSolutionCache, 'project', diagnosticOutput);
      }
    }),
    vscode.commands.registerCommand('visualnuget.managePackagesPalette', async () => {
      const projectFileUri = await quickPick.pickProjectFile();
      if (projectFileUri) {
        UiPanel.createOrShow(
          context.extensionPath,
          projectFileUri,
          sessionPackageCache,
          sessionSolutionCache,
          'project',
          diagnosticOutput
        );
      }
    }),
    vscode.commands.registerCommand('visualnuget.manageSolutionPackages', (uri: vscode.Uri) => {
      if (uri) {
        UiPanel.createOrShow(context.extensionPath, uri, sessionPackageCache, sessionSolutionCache, 'solution', diagnosticOutput);
      }
    }),
    vscode.commands.registerCommand('visualnuget.manageSolutionPackagesPalette', async () => {
      const solutionFileUri = await quickPick.pickSolutionFile();
      if (solutionFileUri) {
        UiPanel.createOrShow(
          context.extensionPath,
          solutionFileUri,
          sessionPackageCache,
          sessionSolutionCache,
          'solution',
          diagnosticOutput
        );
      }
    })
  );
}
