import * as vscode from 'vscode';

import * as quickPick from './services/quick-pick';
import SessionPackageCache from './services/session-package-cache';
import SessionSolutionCache from './services/session-solution-cache';
import UiPanel from './ui-panel';
import { activate } from './extension';
import { Solution } from '../src-common/models/project';

jest.mock('vscode', () => ({
  commands: {
    registerCommand: jest.fn(() => ({ dispose: jest.fn() })),
  },
  window: {
    createOutputChannel: jest.fn(() => ({ appendLine: jest.fn(), dispose: jest.fn() })),
  },
  Uri: {
    file: jest.fn((fsPath: string) => ({ fsPath })),
  },
  workspace: (() => {
    const fileCreateListeners: Array<(uri: { fsPath: string }) => void> = [];
    const fileChangeListeners: Array<(uri: { fsPath: string }) => void> = [];
    const fileDeleteListeners: Array<(uri: { fsPath: string }) => void> = [];
    const workspaceFolderChangeListeners: Array<() => void> = [];
    const registerWorkspaceFolderChange = (listener: () => void) => {
      workspaceFolderChangeListeners.push(listener);
      return { dispose: jest.fn() };
    };
    const registerFileListener = (
      listeners: Array<(uri: { fsPath: string }) => void>,
      listener: (uri: { fsPath: string }) => void
    ) => {
      listeners.push(listener);
      return { dispose: jest.fn() };
    };
    return {
      createFileSystemWatcher: jest.fn(() => ({
        onDidCreate: jest.fn((listener: (uri: { fsPath: string }) => void) =>
          registerFileListener(fileCreateListeners, listener)
        ),
        onDidChange: jest.fn((listener: (uri: { fsPath: string }) => void) =>
          registerFileListener(fileChangeListeners, listener)
        ),
        onDidDelete: jest.fn((listener: (uri: { fsPath: string }) => void) =>
          registerFileListener(fileDeleteListeners, listener)
        ),
        dispose: jest.fn(),
      })),
      getWorkspaceFolder: jest.fn(() => ({ uri: { fsPath: 'workspace' } })),
      onDidChangeWorkspaceFolders: jest.fn(registerWorkspaceFolderChange),
      testHooks: { fileCreateListeners, fileChangeListeners, fileDeleteListeners, workspaceFolderChangeListeners },
    };
  })(),
}));

describe('extension session package cache lifetime', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('shares one cache across project and solution commands and clears it on deactivation', async () => {
    const createPanel = jest.spyOn(UiPanel, 'createOrShow').mockImplementation(() => ({}));
    const pickProjectFile = jest.spyOn(quickPick, 'pickProjectFile').mockResolvedValue({ fsPath: 'Palette.csproj' } as vscode.Uri);
    const pickSolutionFile = jest.spyOn(quickPick, 'pickSolutionFile').mockResolvedValue({ fsPath: 'Palette.sln' } as vscode.Uri);
    const subscriptions: vscode.Disposable[] = [];
    const context = { extensionPath: 'extension-path', subscriptions } as unknown as vscode.ExtensionContext;

    activate(context);
    const diagnosticOutput = (vscode.window.createOutputChannel as jest.Mock).mock.results[0]?.value;

    const commandCallbacks = new Map<string, (...args: unknown[]) => unknown>(
      (vscode.commands.registerCommand as jest.Mock).mock.calls.map(([command, callback]) => [
        command as string,
        callback as (...args: unknown[]) => unknown,
      ])
    );
    const projectUri = { fsPath: 'App.csproj' } as vscode.Uri;
    const solutionUri = { fsPath: 'Workspace.slnx' } as vscode.Uri;
    const projectCommand = commandCallbacks.get('visualnuget.managePackages');
    const projectPaletteCommand = commandCallbacks.get('visualnuget.managePackagesPalette');
    const solutionCommand = commandCallbacks.get('visualnuget.manageSolutionPackages');
    const solutionPaletteCommand = commandCallbacks.get('visualnuget.manageSolutionPackagesPalette');
    if (!projectCommand || !projectPaletteCommand || !solutionCommand || !solutionPaletteCommand) {
      throw new Error('Expected package management commands to be registered.');
    }

    projectCommand(projectUri);
    await projectPaletteCommand();
    solutionCommand(solutionUri);
    await solutionPaletteCommand();

    expect(createPanel).toHaveBeenNthCalledWith(
      1,
      'extension-path',
      projectUri,
      expect.any(SessionPackageCache),
      expect.any(SessionSolutionCache),
      'project',
      diagnosticOutput
    );
    const sharedCache = createPanel.mock.calls[0]?.[2];
    const sharedSolutionCache = createPanel.mock.calls[0]?.[3];
    expect(createPanel.mock.calls.map(([, , cache]) => cache)).toEqual([
      sharedCache,
      sharedCache,
      sharedCache,
      sharedCache,
    ]);
    expect(createPanel.mock.calls.map(([, , , solutionCache]) => solutionCache)).toEqual([
      sharedSolutionCache,
      sharedSolutionCache,
      sharedSolutionCache,
      sharedSolutionCache,
    ]);
    expect(createPanel).toHaveBeenNthCalledWith(
      2,
      'extension-path',
      { fsPath: 'Palette.csproj' },
      sharedCache,
      sharedSolutionCache,
      'project',
      diagnosticOutput
    );
    expect(createPanel).toHaveBeenNthCalledWith(
      3,
      'extension-path',
      solutionUri,
      sharedCache,
      sharedSolutionCache,
      'solution',
      diagnosticOutput
    );
    expect(createPanel).toHaveBeenNthCalledWith(
      4,
      'extension-path',
      { fsPath: 'Palette.sln' },
      sharedCache,
      sharedSolutionCache,
      'solution',
      diagnosticOutput
    );
    expect(pickProjectFile).toHaveBeenCalledTimes(1);
    expect(pickSolutionFile).toHaveBeenCalledTimes(1);

    if (!(sharedCache instanceof SessionPackageCache) || !(sharedSolutionCache instanceof SessionSolutionCache)) {
      throw new Error('Expected activation to create shared session caches.');
    }
    sharedCache.set('session-entry', 'https://feed.example.test', 'package-data', '{}');
    const inventory: Solution = {
      name: 'Workspace',
      fsPath: solutionUri.fsPath,
      projects: [],
      unsupportedProjects: [],
      loadFailures: [],
    };
    await sharedSolutionCache.getOrLoad(inventory.fsPath, () => Promise.resolve(inventory));
    expect(sharedSolutionCache.get(inventory.fsPath)).toEqual(inventory);
    const workspace = vscode.workspace as unknown as {
      createFileSystemWatcher: jest.Mock;
      testHooks: {
        fileCreateListeners: Array<(uri: { fsPath: string }) => void>;
        fileChangeListeners: Array<(uri: { fsPath: string }) => void>;
        fileDeleteListeners: Array<(uri: { fsPath: string }) => void>;
        workspaceFolderChangeListeners: Array<() => void>;
      };
    };
    expect(workspace.createFileSystemWatcher).toHaveBeenCalledWith(expect.stringContaining('project.assets.json'));
    for (const invalidate of [
      ...workspace.testHooks.fileCreateListeners,
      ...workspace.testHooks.fileChangeListeners,
      ...workspace.testHooks.fileDeleteListeners,
    ]) {
      await sharedSolutionCache.getOrLoad(inventory.fsPath, () => Promise.resolve(inventory));
      invalidate({ fsPath: 'C:\\workspace\\project.assets.json' });
      expect(sharedSolutionCache.get(inventory.fsPath)).toBeUndefined();
    }
    expect(diagnosticOutput.appendLine).toHaveBeenCalledWith(
      'solution-inventory INVALIDATED, reason=watched-file-created, filePath=C:\\workspace\\project.assets.json, entries=1'
    );

    await sharedSolutionCache.getOrLoad(inventory.fsPath, () => Promise.resolve(inventory));
    workspace.testHooks.fileCreateListeners[0]?.({ fsPath: 'C:\\workspace\\.csdevkit-dtb-temp.sln' });
    expect(sharedSolutionCache.get(inventory.fsPath)).toEqual(inventory);
    expect(diagnosticOutput.appendLine).toHaveBeenCalledWith(
      'solution-inventory FILE_EVENT, reason=watched-file-created, filePath=C:\\workspace\\.csdevkit-dtb-temp.sln, invalidated=false'
    );

    workspace.testHooks.fileCreateListeners[0]?.({ fsPath: inventory.fsPath });
    expect(sharedSolutionCache.get(inventory.fsPath)).toBeUndefined();
    expect(diagnosticOutput.appendLine).toHaveBeenCalledWith(
      'solution-inventory FILE_EVENT, reason=watched-file-created, filePath=Workspace.slnx, invalidated=true'
    );

    await sharedSolutionCache.getOrLoad(inventory.fsPath, () => Promise.resolve(inventory));
    workspace.testHooks.workspaceFolderChangeListeners[0]?.();
    expect(sharedSolutionCache.get(inventory.fsPath)).toBeUndefined();

    await sharedSolutionCache.getOrLoad(inventory.fsPath, () => Promise.resolve(inventory));
    subscriptions.forEach((subscription) => subscription.dispose());
    expect(sharedCache.get('session-entry')).toBeUndefined();
    expect(sharedSolutionCache.get(inventory.fsPath)).toBeUndefined();
  });
});
