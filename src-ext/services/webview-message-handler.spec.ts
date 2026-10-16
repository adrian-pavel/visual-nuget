jest.mock('vscode', () => {
  const taskEndListeners: Array<(event: { execution: { task: unknown }; exitCode: number }) => void> = [];
  const taskExitCodes: number[] = [];
  const nodeFs = jest.requireActual<typeof import('node:fs')>('node:fs');

  class MockShellExecution {
    public constructor(
      public readonly command: string,
      public readonly args: Array<string | { value: string; quoting: number }>
    ) {}
  }

  class MockTask {
    public presentationOptions?: { reveal: number; focus?: boolean };

    public constructor(
      public readonly definition: { task: string },
      _scope: number,
      _name: string,
      _execution: string,
      public readonly taskExecution: MockShellExecution
    ) {}
  }

  return {
    Disposable: class {
      public dispose(): void {}
    },
    ShellExecution: MockShellExecution,
    ShellQuoting: { Strong: 1 },
    TaskRevealKind: { Never: 2 },
    Task: MockTask,
    TaskScope: { Workspace: 1 },
    tasks: {
      executeTask: jest.fn(async (task: MockTask) => {
        if (task.definition.task === 'add') {
          const projectArgument = task.taskExecution.args.find(
            (argument): argument is { value: string; quoting: number } =>
              typeof argument !== 'string' && argument.value.toLowerCase().endsWith('.csproj')
          );
          if (projectArgument) {
            nodeFs.writeFileSync(projectArgument.value, '<Project Updated />');
          }
        }
        await new Promise((resolve) => setTimeout(resolve, 0));
        const exitCode = taskExitCodes.shift() ?? 0;
        taskEndListeners.forEach((listener) => listener({ execution: { task }, exitCode }));
        return { task };
      }),
      onDidEndTaskProcess: jest.fn((listener: (event: { execution: { task: unknown }; exitCode: number }) => void) => {
        taskEndListeners.push(listener);
        return {
          dispose: () => {
            const index = taskEndListeners.indexOf(listener);
            if (index >= 0) {
              taskEndListeners.splice(index, 1);
            }
          },
        };
      }),
    },
    workspace: {
      onDidChangeConfiguration: jest.fn(() => ({ dispose: jest.fn() })),
      getConfiguration: jest.fn(() => ({ sources: [] })),
      textDocuments: [],
    },
    window: {
      showErrorMessage: jest.fn(),
      showInformationMessage: jest.fn(),
    },
    testHooks: { taskExitCodes },
  };
});

import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { ExtensionMessage, PackageOperationResult } from '../../src-common/models/extension-message';
import { Project, Solution } from '../../src-common/models/project';
import {
  InstallMessage,
  InstallPackageInProjectsMessage,
  LoadSolutionMessage,
  RemovePackageFromProjectsMessage,
  RollbackPackageUpdateMessage,
  SessionCacheClearMessage,
  SessionCacheGetMessage,
  SessionCacheSetMessage,
  UpdatePackagesMessage,
  WebviewMessage,
} from '../../src-common/models/ui-message';
import WebviewMessageHandler from './webview-message-handler';
import SessionPackageCache from './session-package-cache';
import SessionSolutionCache from './session-solution-cache';
import SolutionLoader from './solution-loader';

describe('WebviewMessageHandler package update batches', () => {
  let temporaryDirectory: string;
  let projectPath: string;
  let handler: WebviewMessageHandler;
  let receiveMessage: ((message: WebviewMessage) => void) | undefined;
  let messages: ExtensionMessage[];
  let waitForCompletion: (operationId: string) => Promise<void>;
  let webview: {
    onDidReceiveMessage: jest.Mock;
    postMessage: jest.Mock;
  };
  let waiters: Map<string, () => void>;
  let sessionPackageCache: SessionPackageCache;
  let sessionSolutionCache: SessionSolutionCache;

  beforeEach(async () => {
    temporaryDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'visual-nuget-batch-'));
    projectPath = path.join(temporaryDirectory, 'Batch.csproj');
    await fs.writeFile(projectPath, '<Project />');

    const project: Project = {
      name: 'Batch',
      fsPath: projectPath,
      managePackageVersionsCentrally: false,
      packages: [
        { id: 'Package.One', version: '1.0.0', packageLevel: 'direct', versionFilePath: projectPath },
        { id: 'Package.Two', version: '1.0.0', packageLevel: 'direct', versionFilePath: projectPath },
      ],
    };
    const testHooks = vscode as unknown as { testHooks: { taskExitCodes: number[] } };
    testHooks.testHooks.taskExitCodes.length = 0;
    waiters = new Map<string, () => void>();
    messages = [];
    sessionPackageCache = new SessionPackageCache();
    sessionSolutionCache = new SessionSolutionCache();
    waitForCompletion = (operationId) =>
      new Promise((resolve) => {
        waiters.set(operationId, resolve);
      });

    webview = {
      onDidReceiveMessage: jest.fn((listener: (message: WebviewMessage) => void) => {
        receiveMessage = listener;
        return { dispose: jest.fn() };
      }),
      postMessage: jest.fn((message: ExtensionMessage) => {
        messages.push(message);
        if (message.type === 'operation-completed') {
          waiters.get(message.data.operationId)?.();
        }
        return Promise.resolve(true);
      }),
    };

    handler = new WebviewMessageHandler(
      webview as unknown as vscode.Webview,
      { type: 'project', filePath: projectPath },
      sessionPackageCache,
      sessionSolutionCache
    );
    const privateHandler = handler as unknown as { solutionProjects: Map<string, Project>; loadContext: () => void };
    privateHandler.solutionProjects = new Map([[projectPath, project]]);
    jest.spyOn(privateHandler, 'loadContext').mockImplementation(() => {});
    (vscode.tasks.executeTask as jest.Mock).mockClear();
  });

  afterEach(async () => {
    handler.dispose();
    await fs.rm(temporaryDirectory, { recursive: true, force: true });
  });

  test('continues a solution update batch after failure and reports each project outcome', async () => {
    const projectPaths = ['ProjectA.csproj', 'ProjectB.csproj'].map((name) => path.join(temporaryDirectory, name));
    await Promise.all(projectPaths.map((projectPath) => fs.writeFile(projectPath, '<Project />')));
    const projects: Project[] = projectPaths.map((projectPath) => ({
      name: path.basename(projectPath),
      fsPath: projectPath,
      packages: [{ id: 'Package.Shared', version: '1.0.0', packageLevel: 'direct', versionFilePath: projectPath }],
    }));
    const solutionPath = path.join(temporaryDirectory, 'Sample.sln');
    configureSolutionHandler(solutionPath, projects);

    const testHooks = vscode as unknown as { testHooks: { taskExitCodes: number[] } };
    testHooks.testHooks.taskExitCodes.push(0, 1, 0);
    const operationId = 'solution-update-partial-failure';
    const completed = waitForCompletion(operationId);
    const request: UpdatePackagesMessage = {
      command: 'update-packages-batch',
      operationId,
      buildAfterRestore: false,
      updates: projectPaths.map((projectPath, index) => ({
        projectPaths: [projectPath],
        packageId: 'Package.Shared',
        packageVersion: `${index + 2}.0.0`,
        packageSourceUrl: 'https://packages.example/v3/index.json',
      })),
    };

    receiveMessage?.(request);
    await completed;

    const executedTasks = (vscode.tasks.executeTask as jest.Mock).mock.calls.map(
      ([task]) =>
        task as unknown as {
          definition: { task: string };
          taskExecution: { args: Array<string | { value: string; quoting: number }> };
        }
    );
    expect(executedTasks.map((task) => task.definition.task)).toEqual(['add', 'add', 'restore']);
    expect(executedTasks.slice(0, 2).every((task) => task.taskExecution.args.includes('--no-restore'))).toBe(true);
    expect(executedTasks[2].taskExecution.args[0]).toBe('restore');

    const operationResults = messages.filter((message) => message.type === 'operation-results').pop();
    expect(operationResults?.type).toBe('operation-results');
    if (operationResults?.type !== 'operation-results') {
      throw new Error('A solution batch should report project and restore outcomes.');
    }
    expect(operationResults.data.map((result) => [result.projectPath, result.operation, result.succeeded])).toEqual([
      [projectPaths[0], 'add', true],
      [projectPaths[1], 'add', false],
      [solutionPath, 'restore', true],
    ]);
    expect(operationResults.data[1].message).toContain('exited with code 1');
    expect(operationResults.rollbackId).toEqual(expect.any(String));
    expect(messages.filter((message) => message.type === 'operation-completed')).toHaveLength(1);
  });

  test('preserves solution CPM overrides and framework versions unless explicitly selected', async () => {
    const projectPaths = ['Override.csproj', 'Conditional.csproj'].map((name) => path.join(temporaryDirectory, name));
    await Promise.all(projectPaths.map((projectPath) => fs.writeFile(projectPath, '<Project />')));
    const centralFilePath = path.join(temporaryDirectory, 'Directory.Packages.props');
    const projects: Project[] = [
      {
        name: 'Override.csproj',
        fsPath: projectPaths[0],
        managePackageVersionsCentrally: true,
        packages: [
          {
            id: 'Package.Cpm',
            version: '1.0.0',
            versionSource: 'override',
            packageLevel: 'direct',
            versionFilePath: centralFilePath,
          },
        ],
      },
      {
        name: 'Conditional.csproj',
        fsPath: projectPaths[1],
        managePackageVersionsCentrally: true,
        packages: [
          {
            id: 'Package.Cpm',
            version: 'Varies by target framework',
            versionSource: 'central',
            packageLevel: 'direct',
            versionFilePath: centralFilePath,
            targetFrameworkVersions: [
              {
                targetFramework: 'net9.0',
                version: '1.0.0',
                versionSource: 'central',
                packageLevel: 'direct',
                condition: "'$(TargetFramework)' == 'net9.0'",
              },
              {
                targetFramework: 'net10.0',
                version: '2.0.0',
                versionSource: 'central',
                packageLevel: 'direct',
                condition: "'$(TargetFramework)' == 'net10.0'",
              },
            ],
          },
        ],
      },
    ];
    configureSolutionHandler(path.join(temporaryDirectory, 'Sample.sln'), projects);

    const defaultOperationId = 'preserve-cpm-exceptions';
    const defaultCompleted = waitForCompletion(defaultOperationId);
    const defaultRequest: InstallPackageInProjectsMessage = {
      command: 'add-package-to-projects',
      operationId: defaultOperationId,
      projectPaths,
      packageId: 'Package.Cpm',
      packageVersion: '3.0.0',
      packageSourceUrl: 'https://packages.example/v3/index.json',
    };
    receiveMessage?.(defaultRequest);
    await defaultCompleted;

    const skippedResults = messages.filter((message) => message.type === 'operation-results').pop();
    expect(skippedResults?.type).toBe('operation-results');
    if (skippedResults?.type !== 'operation-results') {
      throw new Error('CPM exception decisions should be reported.');
    }
    expect(skippedResults.data.map((result) => [result.projectPath, result.succeeded, result.skipped])).toEqual([
      [projectPaths[0], false, true],
      [projectPaths[1], false, true],
    ]);
    expect(skippedResults.data.every((result) => result.message?.includes('preserve'))).toBe(true);
    expect(vscode.tasks.executeTask).not.toHaveBeenCalled();

    const selectedOperationId = 'update-cpm-exceptions';
    const selectedCompleted = waitForCompletion(selectedOperationId);
    const selectedRequest: InstallPackageInProjectsMessage = {
      ...defaultRequest,
      operationId: selectedOperationId,
      includeCpmExceptions: true,
    };
    receiveMessage?.(selectedRequest);
    await selectedCompleted;

    const executedTasks = (vscode.tasks.executeTask as jest.Mock).mock.calls.map(
      ([task]) =>
        task as unknown as {
          taskExecution: { args: Array<string | { value: string; quoting: number }> };
        }
    );
    expect(executedTasks).toHaveLength(2);
    expect(executedTasks.map((task) => task.taskExecution.args.slice(0, 6))).toEqual([
      ['package', 'add', 'Package.Cpm', '--version', '3.0.0', '--project'],
      ['package', 'add', 'Package.Cpm', '--version', '3.0.0', '--project'],
    ]);
    expect(executedTasks.map((task) => task.taskExecution.args[6])).toEqual([
      { value: projectPaths[0], quoting: vscode.ShellQuoting.Strong },
      { value: projectPaths[1], quoting: vscode.ShellQuoting.Strong },
    ]);
    const updatedResults = messages.filter((message) => message.type === 'operation-results').pop();
    expect(updatedResults?.type === 'operation-results' ? updatedResults.data.map((result) => result.succeeded) : []).toEqual([
      true,
      true,
    ]);
  });

  test('rejects stale solution projects and skips transitive package removal', async () => {
    const transitiveProjectPath = path.join(temporaryDirectory, 'Transitive.csproj');
    const missingProjectPath = path.join(temporaryDirectory, 'Missing.csproj');
    await fs.writeFile(transitiveProjectPath, '<Project />');
    const project: Project = {
      name: 'Transitive.csproj',
      fsPath: transitiveProjectPath,
      packages: [{ id: 'Package.Shared', version: '1.0.0', packageLevel: 'transitive' }],
    };
    configureSolutionHandler(path.join(temporaryDirectory, 'Sample.sln'), [project]);

    const addOperationId = 'stale-project-add';
    const addCompleted = waitForCompletion(addOperationId);
    receiveMessage?.({
      command: 'add-package-to-projects',
      operationId: addOperationId,
      projectPaths: [missingProjectPath],
      packageId: 'Package.Shared',
      packageVersion: '2.0.0',
      packageSourceUrl: 'https://packages.example/v3/index.json',
    } as InstallPackageInProjectsMessage);
    await addCompleted;

    const staleProjectResults = messages.filter((message) => message.type === 'operation-results').pop();
    expect(staleProjectResults?.type).toBe('operation-results');
    if (staleProjectResults?.type !== 'operation-results') {
      throw new Error('A stale project operation should report its failure.');
    }
    expect(staleProjectResults.data).toEqual([
      expect.objectContaining({
        projectPath: missingProjectPath,
        succeeded: false,
        message: 'The project is no longer part of the loaded solution.',
      }),
    ]);

    const staleRemoveOperationId = 'stale-project-remove';
    const staleRemoveCompleted = waitForCompletion(staleRemoveOperationId);
    receiveMessage?.({
      command: 'remove-package-from-projects',
      operationId: staleRemoveOperationId,
      projectPaths: [missingProjectPath],
      packageId: 'Package.Shared',
    } as RemovePackageFromProjectsMessage);
    await staleRemoveCompleted;

    const staleRemovalResults = messages.filter((message) => message.type === 'operation-results').pop();
    expect(staleRemovalResults?.type).toBe('operation-results');
    if (staleRemovalResults?.type !== 'operation-results') {
      throw new Error('A stale project removal should report its failure.');
    }
    expect(staleRemovalResults.data).toEqual([
      expect.objectContaining({
        projectPath: missingProjectPath,
        succeeded: false,
        message: 'The project is no longer part of the loaded solution.',
      }),
    ]);

    const removeOperationId = 'transitive-package-remove';
    const removeCompleted = waitForCompletion(removeOperationId);
    const removeRequest: RemovePackageFromProjectsMessage = {
      command: 'remove-package-from-projects',
      operationId: removeOperationId,
      projectPaths: [transitiveProjectPath],
      packageId: 'Package.Shared',
    };
    receiveMessage?.(removeRequest);
    await removeCompleted;

    const removalResults = messages.filter((message) => message.type === 'operation-results').pop();
    expect(removalResults?.type).toBe('operation-results');
    if (removalResults?.type !== 'operation-results') {
      throw new Error('A transitive package removal should report that it was skipped.');
    }
    expect(removalResults.data).toEqual([
      expect.objectContaining({
        projectPath: transitiveProjectPath,
        succeeded: false,
        skipped: true,
      }),
    ]);
    expect(vscode.tasks.executeTask).not.toHaveBeenCalled();
  });

  test('applies every package edit without restore and runs one final restore', async () => {
    const operationId = 'batch-operation';
    const completed = waitForCompletion(operationId);
    const request: UpdatePackagesMessage = {
      command: 'update-packages-batch',
      operationId,
      buildAfterRestore: false,
      updates: [
        {
          projectPaths: [projectPath],
          packageId: 'Package.One',
          packageVersion: '2.0.0',
          packageSourceUrl: 'https://packages.example/v3/index.json',
        },
        {
          projectPaths: [projectPath],
          packageId: 'Package.Two',
          packageVersion: '3.0.0',
          packageSourceUrl: 'https://packages.example/v3/index.json',
        },
      ],
    };
    receiveMessage?.(request);
    await completed;

    const executedTasks = (vscode.tasks.executeTask as jest.Mock).mock.calls.map(
      ([task]) =>
        task as unknown as {
          definition: { task: string };
          taskExecution: { args: Array<string | { value: string; quoting: number }> };
          presentationOptions?: { reveal: number; focus?: boolean };
        }
    );
    expect(executedTasks.map((task) => task.definition.task)).toEqual(['add', 'add', 'restore']);
    expect(executedTasks.slice(0, 2).every((task) => task.taskExecution.args.includes('--no-restore'))).toBe(true);
    expect(executedTasks[2].taskExecution.args[0]).toBe('restore');
    expect(executedTasks.every((task) => task.presentationOptions?.reveal === vscode.TaskRevealKind.Never)).toBe(true);
    expect(executedTasks.every((task) => !task.taskExecution.args.includes('--interactive'))).toBe(true);
    expect(messages.filter((message) => message.type === 'operation-completed')).toHaveLength(1);

    const operationResults = messages.filter((message) => message.type === 'operation-results').pop();
    expect(operationResults?.type === 'operation-results' ? operationResults.data.map((result) => result.operation) : []).toEqual([
      'add',
      'add',
      'restore',
    ]);
    expect(
      operationResults?.type === 'operation-results'
        ? operationResults.data.slice(0, 2).map((result) => [result.fromVersion, result.toVersion])
        : []
    ).toEqual([
      ['1.0.0', '2.0.0'],
      ['1.0.0', '3.0.0'],
    ]);
  });

  test('updates each shared central package version once and reports success for every project', async () => {
    const projectPaths = ['CpmA.csproj', 'CpmB.csproj'].map((name) => path.join(temporaryDirectory, name));
    const centralFilePath = path.join(temporaryDirectory, 'Directory.Packages.props');
    const originalCentralFile = [
      '<Project>',
      '  <ItemGroup Label="Packages">',
      '    <!-- Keep unrelated XML intact. -->',
      '    <PackageVersion Include="Package.One" Version="1.0.0" />',
      '    <PackageVersion Update=\'Package.Two\'>',
      '      <Version>1.0.0</Version>',
      '    </PackageVersion>',
      '  </ItemGroup>',
      '</Project>',
      '',
    ].join('\n');
    await Promise.all([
      ...projectPaths.map((projectPath) => fs.writeFile(projectPath, '<Project />')),
      fs.writeFile(centralFilePath, originalCentralFile),
    ]);
    const projects: Project[] = projectPaths.map((projectPath) => ({
      name: path.basename(projectPath),
      fsPath: projectPath,
      managePackageVersionsCentrally: true,
      packages: ['Package.One', 'Package.Two'].map((id) => ({
        id,
        version: '1.0.0',
        versionSource: 'central',
        packageLevel: 'direct',
        versionFilePath: centralFilePath,
        targetFrameworkVersions: [
          {
            targetFramework: 'net8.0',
            version: '1.0.0',
            versionSource: 'central',
            centralVersionDefinitionCount: 1,
            packageLevel: 'direct',
            versionFilePath: centralFilePath,
          },
        ],
      })),
    }));
    configureSolutionHandler(path.join(temporaryDirectory, 'Cpm.sln'), projects);

    const executeTaskMock = vscode.tasks.executeTask as jest.Mock;
    const defaultTaskExecutor = executeTaskMock.getMockImplementation();
    let centralFileContentsAtRestore: string | undefined;
    executeTaskMock.mockImplementationOnce(async (task: { definition: { task: string } }) => {
      if (task.definition.task === 'restore') {
        centralFileContentsAtRestore = await fs.readFile(centralFilePath, 'utf8');
      }
      return defaultTaskExecutor?.(task);
    });

    const operationId = 'cpm-shared-version-updates';
    const completed = waitForCompletion(operationId);
    receiveMessage?.({
      command: 'update-packages-batch',
      operationId,
      buildAfterRestore: false,
      updates: ['Package.One', 'Package.Two'].map((packageId) => ({
        projectPaths,
        packageId,
        packageVersion: '2.0.0',
        packageSourceUrl: 'https://packages.example/v3/index.json',
      })),
    } as UpdatePackagesMessage);
    await completed;

    const executedTasks = (vscode.tasks.executeTask as jest.Mock).mock.calls.map(
      ([task]) =>
        task as unknown as {
          definition: { task: string };
          taskExecution: { args: Array<string | { value: string; quoting: number }> };
        }
    );
    expect(executedTasks.map((task) => task.definition.task)).toEqual(['restore']);
    const updatedCentralFile = await fs.readFile(centralFilePath, 'utf8');
    expect(updatedCentralFile).toBe(
      originalCentralFile
        .replace('Version="1.0.0"', 'Version="2.0.0"')
        .replace('<Version>1.0.0</Version>', '<Version>2.0.0</Version>')
    );
    expect(centralFileContentsAtRestore).toBe(updatedCentralFile);

    const operationResults = messages.filter((message) => message.type === 'operation-results').pop();
    expect(operationResults?.type).toBe('operation-results');
    if (operationResults?.type !== 'operation-results') {
      throw new Error('The CPM batch should report each project result and the restore result.');
    }
    expect(operationResults.data.map((result) => [result.projectPath, result.packageId, result.succeeded])).toEqual([
      [projectPaths[0], 'Package.One', true],
      [projectPaths[1], 'Package.One', true],
      [projectPaths[0], 'Package.Two', true],
      [projectPaths[1], 'Package.Two', true],
      [path.join(temporaryDirectory, 'Cpm.sln'), '(batch)', true],
    ]);
    expect(operationResults.data.slice(0, 4).map((result) => [result.fromVersion, result.toVersion])).toEqual([
      ['1.0.0', '2.0.0'],
      ['1.0.0', '2.0.0'],
      ['1.0.0', '2.0.0'],
      ['1.0.0', '2.0.0'],
    ]);
  });

  test('rolls back bulk central version edits after restore failure', async () => {
    const projectPath = path.join(temporaryDirectory, 'CpmRollback.csproj');
    const centralFilePath = path.join(temporaryDirectory, 'Directory.Packages.props');
    const originalCentralFile = '<Project><ItemGroup><PackageVersion Include="Package.Cpm" Version="1.0.0" /></ItemGroup></Project>';
    await Promise.all([fs.writeFile(projectPath, '<Project />'), fs.writeFile(centralFilePath, originalCentralFile)]);
    const project: Project = {
      name: 'CpmRollback.csproj',
      fsPath: projectPath,
      managePackageVersionsCentrally: true,
      packages: [
        {
          id: 'Package.Cpm',
          version: '1.0.0',
          versionSource: 'central',
          packageLevel: 'direct',
          versionFilePath: centralFilePath,
          targetFrameworkVersions: [
            {
              targetFramework: 'net8.0',
              version: '1.0.0',
              versionSource: 'central',
              centralVersionDefinitionCount: 1,
              packageLevel: 'direct',
              versionFilePath: centralFilePath,
            },
          ],
        },
      ],
    };
    configureSolutionHandler(path.join(temporaryDirectory, 'CpmRollback.sln'), [project]);

    const testHooks = vscode as unknown as { testHooks: { taskExitCodes: number[] } };
    testHooks.testHooks.taskExitCodes.push(1);
    const operationId = 'cpm-rollback-after-restore-failure';
    const completed = waitForCompletion(operationId);
    receiveMessage?.({
      command: 'update-packages-batch',
      operationId,
      buildAfterRestore: false,
      updates: [
        {
          projectPaths: [projectPath],
          packageId: 'Package.Cpm',
          packageVersion: '2.0.0',
          packageSourceUrl: 'https://packages.example/v3/index.json',
        },
      ],
    } as UpdatePackagesMessage);
    await completed;

    const batchResults = messages.filter((message) => message.type === 'operation-results').pop();
    expect(batchResults?.type).toBe('operation-results');
    if (batchResults?.type !== 'operation-results' || !batchResults.rollbackId) {
      throw new Error('A failed restore after a central edit should provide a rollback action.');
    }
    await expect(fs.readFile(centralFilePath, 'utf8')).resolves.toBe(
      '<Project><ItemGroup><PackageVersion Include="Package.Cpm" Version="2.0.0" /></ItemGroup></Project>'
    );

    const rollbackOperationId = 'cpm-rollback-operation';
    const rollbackCompleted = waitForCompletion(rollbackOperationId);
    receiveMessage?.({
      command: 'rollback-package-update',
      operationId: rollbackOperationId,
      rollbackId: batchResults.rollbackId,
    } as RollbackPackageUpdateMessage);
    await rollbackCompleted;

    await expect(fs.readFile(centralFilePath, 'utf8')).resolves.toBe(originalCentralFile);
    const rollbackResults = messages.filter((message) => message.type === 'operation-results').pop();
    expect(rollbackResults).toMatchObject({
      type: 'operation-results',
      data: [expect.objectContaining({ operation: 'rollback', succeeded: true })],
    });
  });

  test('keeps CPM updates separate when projects use different central version files', async () => {
    const projectPaths = ['CpmA.csproj', 'CpmB.csproj'].map((name) => path.join(temporaryDirectory, name));
    const centralFilePaths = ['A.Directory.Packages.props', 'B.Directory.Packages.props'].map((name) =>
      path.join(temporaryDirectory, name)
    );
    await Promise.all([
      ...projectPaths.map((projectPath) => fs.writeFile(projectPath, '<Project />')),
      ...centralFilePaths.map((filePath) =>
        fs.writeFile(
          filePath,
          '<Project><ItemGroup><PackageVersion Include="Package.Cpm" Version="1.0.0" /></ItemGroup></Project>'
        )
      ),
    ]);
    const projects: Project[] = projectPaths.map((projectPath, index) => ({
      name: path.basename(projectPath),
      fsPath: projectPath,
      managePackageVersionsCentrally: true,
      packages: [
        {
          id: 'Package.Cpm',
          version: '1.0.0',
          versionSource: 'central',
          packageLevel: 'direct',
          versionFilePath: centralFilePaths[index],
          targetFrameworkVersions: [
            {
              targetFramework: 'net8.0',
              version: '1.0.0',
              versionSource: 'central',
              centralVersionDefinitionCount: 1,
              packageLevel: 'direct',
              versionFilePath: centralFilePaths[index],
            },
          ],
        },
      ],
    }));
    configureSolutionHandler(path.join(temporaryDirectory, 'SeparateCpm.sln'), projects);

    const operationId = 'separate-central-files';
    const completed = waitForCompletion(operationId);
    receiveMessage?.({
      command: 'update-packages-batch',
      operationId,
      buildAfterRestore: false,
      updates: [
        {
          projectPaths,
          packageId: 'Package.Cpm',
          packageVersion: '2.0.0',
          packageSourceUrl: 'https://packages.example/v3/index.json',
        },
      ],
    } as UpdatePackagesMessage);
    await completed;

    const executedTasks = (vscode.tasks.executeTask as jest.Mock).mock.calls.map(
      ([task]) =>
        task as unknown as {
          definition: { task: string };
          taskExecution: { args: Array<string | { value: string; quoting: number }> };
        }
    );
    expect(executedTasks.map((task) => task.definition.task)).toEqual(['restore']);
    await expect(Promise.all(centralFilePaths.map((filePath) => fs.readFile(filePath, 'utf8')))).resolves.toEqual(
      centralFilePaths.map((filePath) => '<Project><ItemGroup><PackageVersion Include="Package.Cpm" Version="2.0.0" /></ItemGroup></Project>')
    );
  });

  test('falls back without partially editing a props file containing an MSBuild version expression', async () => {
    const projectPath = path.join(temporaryDirectory, 'CpmExpression.csproj');
    const centralFilePath = path.join(temporaryDirectory, 'Directory.Packages.props');
    const centralFile = [
      '<Project><ItemGroup>',
      '<PackageVersion Include="Package.Literal" Version="1.0.0" />',
      '<PackageVersion Include="Package.Cpm" Version="$(CpmVersion)" />',
      '</ItemGroup></Project>',
    ].join('');
    await Promise.all([fs.writeFile(projectPath, '<Project />'), fs.writeFile(centralFilePath, centralFile)]);
    const project: Project = {
      name: 'CpmExpression.csproj',
      fsPath: projectPath,
      managePackageVersionsCentrally: true,
      packages: ['Package.Literal', 'Package.Cpm'].map((id) => ({
        id,
        version: '1.0.0',
        versionSource: 'central' as const,
        packageLevel: 'direct' as const,
        versionFilePath: centralFilePath,
        targetFrameworkVersions: [
          {
            targetFramework: 'net8.0',
            version: '1.0.0',
            versionSource: 'central' as const,
            centralVersionDefinitionCount: 1,
            packageLevel: 'direct' as const,
            versionFilePath: centralFilePath,
          },
        ],
      })),
    };
    configureSolutionHandler(path.join(temporaryDirectory, 'CpmExpression.sln'), [project]);

    const operationId = 'cpm-expression-fallback';
    const completed = waitForCompletion(operationId);
    receiveMessage?.({
      command: 'update-packages-batch',
      operationId,
      buildAfterRestore: false,
      updates: ['Package.Literal', 'Package.Cpm'].map((packageId) => ({
        projectPaths: [projectPath],
        packageId,
        packageVersion: '2.0.0',
        packageSourceUrl: 'https://packages.example/v3/index.json',
      })),
    } as UpdatePackagesMessage);
    await completed;

    const executedTasks = (vscode.tasks.executeTask as jest.Mock).mock.calls.map(
      ([task]) =>
        task as unknown as {
          definition: { task: string };
          taskExecution: { args: Array<string | { value: string; quoting: number }> };
        }
    );
    expect(executedTasks.map((task) => task.definition.task)).toEqual(['add', 'add', 'restore']);
    expect(executedTasks.slice(0, 2).every((task) => task.taskExecution.args.includes('--no-restore'))).toBe(true);
    await expect(fs.readFile(centralFilePath, 'utf8')).resolves.toBe(centralFile);
  });

  test('falls back to CLI updates when MSBuild reports multiple central definitions', async () => {
    const projectPath = path.join(temporaryDirectory, 'CpmDuplicateDefinitions.csproj');
    const centralFilePath = path.join(temporaryDirectory, 'Directory.Packages.props');
    const centralFile = '<Project><ItemGroup><PackageVersion Include="Package.Cpm" Version="1.0.0" /></ItemGroup></Project>';
    await Promise.all([fs.writeFile(projectPath, '<Project />'), fs.writeFile(centralFilePath, centralFile)]);
    const project: Project = {
      name: 'CpmDuplicateDefinitions.csproj',
      fsPath: projectPath,
      managePackageVersionsCentrally: true,
      packages: [
        {
          id: 'Package.Cpm',
          version: '1.0.0',
          versionSource: 'central',
          packageLevel: 'direct',
          versionFilePath: centralFilePath,
          targetFrameworkVersions: [
            {
              targetFramework: 'net8.0',
              version: '1.0.0',
              versionSource: 'central',
              centralVersionDefinitionCount: 2,
              packageLevel: 'direct',
              versionFilePath: centralFilePath,
            },
          ],
        },
      ],
    };
    configureSolutionHandler(path.join(temporaryDirectory, 'CpmDuplicateDefinitions.sln'), [project]);

    const operationId = 'cpm-duplicate-definition-fallback';
    const completed = waitForCompletion(operationId);
    receiveMessage?.({
      command: 'update-packages-batch',
      operationId,
      buildAfterRestore: false,
      updates: [
        {
          projectPaths: [projectPath],
          packageId: 'Package.Cpm',
          packageVersion: '2.0.0',
          packageSourceUrl: 'https://packages.example/v3/index.json',
        },
      ],
    } as UpdatePackagesMessage);
    await completed;

    const executedTasks = (vscode.tasks.executeTask as jest.Mock).mock.calls.map(
      ([task]) =>
        task as unknown as {
          definition: { task: string };
          taskExecution: { args: Array<string | { value: string; quoting: number }> };
        }
    );
    expect(executedTasks.map((task) => task.definition.task)).toEqual(['add', 'restore']);
    expect(executedTasks[0].taskExecution.args).toContain('--no-restore');
    await expect(fs.readFile(centralFilePath, 'utf8')).resolves.toBe(centralFile);
  });

  test('mixes an eligible CPM bulk edit with a CLI fallback before one restore', async () => {
    const bulkProjectPath = path.join(temporaryDirectory, 'CpmBulk.csproj');
    const fallbackProjectPath = path.join(temporaryDirectory, 'CpmFallback.csproj');
    const bulkCentralFilePath = path.join(temporaryDirectory, 'Bulk.Directory.Packages.props');
    const fallbackCentralFilePath = path.join(temporaryDirectory, 'Fallback.Directory.Packages.props');
    const bulkCentralFile = '<Project><ItemGroup><PackageVersion Include="Package.Bulk" Version="1.0.0" /></ItemGroup></Project>';
    const fallbackCentralFile = [
      '<Project><ItemGroup>',
      '<PackageVersion Include="Package.Fallback" Version="1.0.0" />',
      '<PackageVersion Include="Package.Fallback" Version="1.1.0" />',
      '</ItemGroup></Project>',
    ].join('');
    await Promise.all([
      fs.writeFile(bulkProjectPath, '<Project />'),
      fs.writeFile(fallbackProjectPath, '<Project />'),
      fs.writeFile(bulkCentralFilePath, bulkCentralFile),
      fs.writeFile(fallbackCentralFilePath, fallbackCentralFile),
    ]);
    const projects: Project[] = [
      {
        name: 'CpmBulk.csproj',
        fsPath: bulkProjectPath,
        managePackageVersionsCentrally: true,
        packages: [
          {
            id: 'Package.Bulk',
            version: '1.0.0',
            versionSource: 'central',
            packageLevel: 'direct',
            versionFilePath: bulkCentralFilePath,
            targetFrameworkVersions: [
              {
                targetFramework: 'net8.0',
                version: '1.0.0',
                versionSource: 'central',
                centralVersionDefinitionCount: 1,
                packageLevel: 'direct',
                versionFilePath: bulkCentralFilePath,
              },
            ],
          },
        ],
      },
      {
        name: 'CpmFallback.csproj',
        fsPath: fallbackProjectPath,
        managePackageVersionsCentrally: true,
        packages: [
          {
            id: 'Package.Fallback',
            version: '1.0.0',
            versionSource: 'central',
            packageLevel: 'direct',
            versionFilePath: fallbackCentralFilePath,
            targetFrameworkVersions: [
              {
                targetFramework: 'net8.0',
                version: '1.0.0',
                versionSource: 'central',
                centralVersionDefinitionCount: 2,
                packageLevel: 'direct',
                versionFilePath: fallbackCentralFilePath,
              },
            ],
          },
        ],
      },
    ];
    configureSolutionHandler(path.join(temporaryDirectory, 'MixedCpm.sln'), projects);

    const executeTaskMock = vscode.tasks.executeTask as jest.Mock;
    const defaultTaskExecutor = executeTaskMock.getMockImplementation();
    const executionOrder: string[] = [];
    let fallbackContentsAtCliUpdate: string | undefined;
    let bulkContentsAtRestore: string | undefined;
    executeTaskMock
      .mockImplementationOnce(async (task: { definition: { task: string } }) => {
        executionOrder.push(task.definition.task);
        if (task.definition.task === 'add') {
          fallbackContentsAtCliUpdate = await fs.readFile(fallbackCentralFilePath, 'utf8');
        }
        return defaultTaskExecutor?.(task);
      })
      .mockImplementationOnce(async (task: { definition: { task: string } }) => {
        executionOrder.push(task.definition.task);
        if (task.definition.task === 'restore') {
          bulkContentsAtRestore = await fs.readFile(bulkCentralFilePath, 'utf8');
        }
        return defaultTaskExecutor?.(task);
      });

    const operationId = 'mixed-cpm-bulk-and-fallback';
    const completed = waitForCompletion(operationId);
    receiveMessage?.({
      command: 'update-packages-batch',
      operationId,
      buildAfterRestore: false,
      updates: [
        {
          projectPaths: [bulkProjectPath],
          packageId: 'Package.Bulk',
          packageVersion: '2.0.0',
          packageSourceUrl: 'https://packages.example/v3/index.json',
        },
        {
          projectPaths: [fallbackProjectPath],
          packageId: 'Package.Fallback',
          packageVersion: '2.0.0',
          packageSourceUrl: 'https://packages.example/v3/index.json',
        },
      ],
    } as UpdatePackagesMessage);
    await completed;

    const executedTasks = (vscode.tasks.executeTask as jest.Mock).mock.calls.map(
      ([task]) =>
        task as unknown as {
          definition: { task: string };
          taskExecution: { args: Array<string | { value: string; quoting: number }> };
        }
    );
    expect(executedTasks.map((task) => task.definition.task)).toEqual(['add', 'restore']);
    expect(executionOrder).toEqual(['add', 'restore']);
    expect(executedTasks[0]?.taskExecution.args).toContain('Package.Fallback');
    expect(executedTasks[0]?.taskExecution.args).toContain('--no-restore');
    expect(fallbackContentsAtCliUpdate).toBe(fallbackCentralFile);
    await expect(fs.readFile(bulkCentralFilePath, 'utf8')).resolves.toBe(
      '<Project><ItemGroup><PackageVersion Include="Package.Bulk" Version="2.0.0" /></ItemGroup></Project>'
    );
    expect(bulkContentsAtRestore).toBe(
      '<Project><ItemGroup><PackageVersion Include="Package.Bulk" Version="2.0.0" /></ItemGroup></Project>'
    );
  });

  test('does not overwrite a central file changed after the batch snapshot', async () => {
    const projectPath = path.join(temporaryDirectory, 'CpmConcurrentChange.csproj');
    const centralFilePath = path.join(temporaryDirectory, 'Directory.Packages.props');
    const originalCentralFile = '<Project><ItemGroup><PackageVersion Include="Package.Cpm" Version="1.0.0" /></ItemGroup></Project>';
    const concurrentCentralFile =
      '<Project><ItemGroup><PackageVersion Include="Package.Cpm" Version="3.0.0" /></ItemGroup></Project>';
    await Promise.all([fs.writeFile(projectPath, '<Project />'), fs.writeFile(centralFilePath, originalCentralFile)]);
    const project: Project = {
      name: 'CpmConcurrentChange.csproj',
      fsPath: projectPath,
      managePackageVersionsCentrally: true,
      packages: [
        {
          id: 'Package.Cpm',
          version: '1.0.0',
          versionSource: 'central',
          packageLevel: 'direct',
          versionFilePath: centralFilePath,
          targetFrameworkVersions: [
            {
              targetFramework: 'net8.0',
              version: '1.0.0',
              versionSource: 'central',
              centralVersionDefinitionCount: 1,
              packageLevel: 'direct',
              versionFilePath: centralFilePath,
            },
          ],
        },
      ],
    };
    configureSolutionHandler(path.join(temporaryDirectory, 'CpmConcurrentChange.sln'), [project]);

    const originalPostMessage = webview.postMessage.getMockImplementation();
    const { writeFileSync } = jest.requireActual<typeof import('node:fs')>('node:fs');
    let concurrentChangeWritten = false;
    webview.postMessage.mockImplementation((message: ExtensionMessage) => {
      if (message.type === 'operation-progress' && message.data.message.startsWith('Updating 1 central package version')) {
        writeFileSync(centralFilePath, concurrentCentralFile);
        concurrentChangeWritten = true;
      }
      return originalPostMessage?.(message);
    });

    const operationId = 'cpm-concurrent-file-change';
    const completed = waitForCompletion(operationId);
    receiveMessage?.({
      command: 'update-packages-batch',
      operationId,
      buildAfterRestore: false,
      updates: [
        {
          projectPaths: [projectPath],
          packageId: 'Package.Cpm',
          packageVersion: '2.0.0',
          packageSourceUrl: 'https://packages.example/v3/index.json',
        },
      ],
    } as UpdatePackagesMessage);
    await completed;

    expect(concurrentChangeWritten).toBe(true);
    await expect(fs.readFile(centralFilePath, 'utf8')).resolves.toBe(concurrentCentralFile);
    expect(vscode.tasks.executeTask).not.toHaveBeenCalled();
    const operationResults = messages.filter((message) => message.type === 'operation-results').pop();
    expect(operationResults).toMatchObject({
      type: 'operation-results',
      data: [
        expect.objectContaining({
          packageId: '(batch)',
          succeeded: false,
          message: expect.stringContaining('Central package version file changed during the update'),
        }),
      ],
    });
  });

  test('keeps non-CPM updates per project', async () => {
    const projectPaths = ['ProjectA.csproj', 'ProjectB.csproj'].map((name) => path.join(temporaryDirectory, name));
    await Promise.all(projectPaths.map((projectPath) => fs.writeFile(projectPath, '<Project />')));
    const projects: Project[] = projectPaths.map((projectPath) => ({
      name: path.basename(projectPath),
      fsPath: projectPath,
      managePackageVersionsCentrally: false,
      packages: [{ id: 'Package.Shared', version: '1.0.0', packageLevel: 'direct', versionFilePath: projectPath }],
    }));
    configureSolutionHandler(path.join(temporaryDirectory, 'NonCpm.sln'), projects);

    const operationId = 'non-cpm-project-updates';
    const completed = waitForCompletion(operationId);
    receiveMessage?.({
      command: 'update-packages-batch',
      operationId,
      buildAfterRestore: false,
      updates: [
        {
          projectPaths,
          packageId: 'Package.Shared',
          packageVersion: '2.0.0',
          packageSourceUrl: 'https://packages.example/v3/index.json',
        },
      ],
    } as UpdatePackagesMessage);
    await completed;

    const executedTasks = (vscode.tasks.executeTask as jest.Mock).mock.calls.map(
      ([task]) =>
        task as unknown as {
          definition: { task: string };
          taskExecution: { args: Array<string | { value: string; quoting: number }> };
        }
    );
    expect(executedTasks.map((task) => task.definition.task)).toEqual(['add', 'add', 'restore']);
    expect(executedTasks.slice(0, 2).map((task) => task.taskExecution.args.slice(0, 2))).toEqual([
      ['add', { value: projectPaths[0], quoting: vscode.ShellQuoting.Strong }],
      ['add', { value: projectPaths[1], quoting: vscode.ShellQuoting.Strong }],
    ]);
  });

  test('keeps explicitly selected conditional CPM exceptions as separate project updates', async () => {
    const projectPaths = ['CpmA.csproj', 'CpmB.csproj'].map((name) => path.join(temporaryDirectory, name));
    const centralFilePath = path.join(temporaryDirectory, 'Directory.Packages.props');
    await Promise.all([...projectPaths.map((projectPath) => fs.writeFile(projectPath, '<Project />')), fs.writeFile(centralFilePath, '<Project />')]);
    const projects: Project[] = projectPaths.map((projectPath, index) => ({
      name: path.basename(projectPath),
      fsPath: projectPath,
      managePackageVersionsCentrally: true,
      packages: [
        {
          id: 'Package.Conditional',
          version: '1.0.0',
          versionSource: 'central',
          packageLevel: 'direct',
          versionFilePath: centralFilePath,
          targetFrameworkVersions: [
            {
              targetFramework: index === 0 ? 'net8.0' : 'net9.0',
              version: '1.0.0',
              versionSource: 'central',
              packageLevel: 'direct',
              condition: `'$(TargetFramework)' == 'net${index === 0 ? '8' : '9'}.0'`,
              versionFilePath: centralFilePath,
            },
          ],
        },
      ],
    }));
    configureSolutionHandler(path.join(temporaryDirectory, 'ConditionalCpm.sln'), projects);

    const operationId = 'conditional-cpm-updates';
    const completed = waitForCompletion(operationId);
    receiveMessage?.({
      command: 'update-packages-batch',
      operationId,
      buildAfterRestore: false,
      updates: [
        {
          projectPaths,
          packageId: 'Package.Conditional',
          packageVersion: '2.0.0',
          packageSourceUrl: 'https://packages.example/v3/index.json',
          includeCpmExceptions: true,
        },
      ],
    } as UpdatePackagesMessage);
    await completed;

    const executedTasks = (vscode.tasks.executeTask as jest.Mock).mock.calls.map(
      ([task]) =>
        task as unknown as {
          definition: { task: string };
          taskExecution: { args: Array<string | { value: string; quoting: number }> };
        }
    );
    expect(executedTasks.map((task) => task.definition.task)).toEqual(['add', 'add', 'restore']);
    expect(
      executedTasks.slice(0, 2).map((task) => task.taskExecution.args.find(
        (argument): argument is { value: string; quoting: number } =>
          typeof argument !== 'string' && argument.value.endsWith('.csproj')
      )?.value)
    ).toEqual(projectPaths);
  });

  test('falls back to individual project updates when a shared CPM update fails', async () => {
    const projectPaths = ['CpmA.csproj', 'CpmB.csproj'].map((name) => path.join(temporaryDirectory, name));
    const centralFilePath = path.join(temporaryDirectory, 'Directory.Packages.props');
    await Promise.all([...projectPaths.map((projectPath) => fs.writeFile(projectPath, '<Project />')), fs.writeFile(centralFilePath, '<Project />')]);
    const projects: Project[] = projectPaths.map((projectPath) => ({
      name: path.basename(projectPath),
      fsPath: projectPath,
      managePackageVersionsCentrally: true,
      packages: [
        {
          id: 'Package.Cpm',
          version: '1.0.0',
          versionSource: 'central',
          packageLevel: 'direct',
          versionFilePath: centralFilePath,
          targetFrameworkVersions: [
            {
              targetFramework: 'net8.0',
              version: '1.0.0',
              versionSource: 'central',
              centralVersionDefinitionCount: 1,
              packageLevel: 'direct',
              versionFilePath: centralFilePath,
            },
          ],
        },
      ],
    }));
    configureSolutionHandler(path.join(temporaryDirectory, 'CpmFailure.sln'), projects);
    const testHooks = vscode as unknown as { testHooks: { taskExitCodes: number[] } };
    testHooks.testHooks.taskExitCodes.push(1, 0, 0);

    const operationId = 'cpm-fallback-after-failure';
    const completed = waitForCompletion(operationId);
    receiveMessage?.({
      command: 'update-packages-batch',
      operationId,
      buildAfterRestore: false,
      updates: [
        {
          projectPaths,
          packageId: 'Package.Cpm',
          packageVersion: '2.0.0',
          packageSourceUrl: 'https://packages.example/v3/index.json',
        },
      ],
    } as UpdatePackagesMessage);
    await completed;

    const executedTasks = (vscode.tasks.executeTask as jest.Mock).mock.calls.map(
      ([task]) =>
        task as unknown as {
          definition: { task: string };
          taskExecution: { args: Array<string | { value: string; quoting: number }> };
        }
    );
    expect(executedTasks.map((task) => task.definition.task)).toEqual(['add', 'add', 'restore']);
    expect(executedTasks.slice(0, 2).map((task) => task.taskExecution.args.find(
      (argument): argument is { value: string; quoting: number } =>
        typeof argument !== 'string' && argument.value.endsWith('.csproj')
    )?.value)).toEqual(projectPaths);
    const operationResults = messages.filter((message) => message.type === 'operation-results').pop();
    expect(operationResults?.type).toBe('operation-results');
    if (operationResults?.type !== 'operation-results') {
      throw new Error('The CPM fallback should report each project result.');
    }
    expect(operationResults.data.map((result) => [result.projectPath, result.succeeded])).toEqual([
      [projectPaths[0], false],
      [projectPaths[1], true],
      [path.join(temporaryDirectory, 'CpmFailure.sln'), true],
    ]);
  });

  test('reports a failed single-package install without revealing an interactive terminal', async () => {
    const testHooks = vscode as unknown as { testHooks: { taskExitCodes: number[] } };
    testHooks.testHooks.taskExitCodes.push(1);
    const operationId = 'single-package-failure';
    const completed = waitForCompletion(operationId);
    receiveMessage?.({
      command: 'add-package',
      operationId,
      projectName: projectPath,
      packageId: 'Package.Failed',
      packageVersion: '1.0.0',
      packageSourceUrl: 'https://packages.example/v3/index.json',
    } as InstallMessage);
    await completed;

    const operationResults = messages.filter((message) => message.type === 'operation-results').pop();
    expect(operationResults?.type).toBe('operation-results');
    if (operationResults?.type !== 'operation-results') {
      throw new Error('A single-package install should report its result.');
    }
    expect(operationResults.data).toEqual([
      expect.objectContaining({
        packageId: 'Package.Failed',
        operation: 'add',
        succeeded: false,
        message: 'dotnet add package exited with code 1.',
      }),
    ]);

    const task = (vscode.tasks.executeTask as jest.Mock).mock.calls[0][0] as {
      presentationOptions?: { reveal: number; focus?: boolean };
      taskExecution: { args: Array<string | { value: string; quoting: number }> };
    };
    expect(task.presentationOptions?.reveal).toBe(vscode.TaskRevealKind.Never);
    expect(task.taskExecution.args).not.toContain('--interactive');
  });

  test('loads project context through the fast package inventory path', async () => {
    const project: Project = {
      name: 'Batch',
      fsPath: projectPath,
      packages: [],
      packageMetadataComplete: false,
    };
    const loadProjectInventoryAsync = jest.fn().mockResolvedValue(project);
    const loadProjectAsync = jest.fn();
    const internals = handler as unknown as {
      projectFileLoader: {
        loadProjectInventoryAsync: typeof loadProjectInventoryAsync;
        loadProjectAsync: typeof loadProjectAsync;
      };
      loadContext: () => void;
    };
    internals.projectFileLoader = { loadProjectInventoryAsync, loadProjectAsync };

    (internals.loadContext as jest.Mock).mockRestore();
    internals.loadContext();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(loadProjectInventoryAsync).toHaveBeenCalledWith(projectPath);
    expect(loadProjectAsync).not.toHaveBeenCalled();
    expect(messages).toContainEqual({ type: 'project', data: project });
  });

  test('loads CPM metadata before adding to a fast-loaded project inventory', async () => {
    const initialProject = {
      name: 'Batch',
      fsPath: projectPath,
      packages: [],
      packageMetadataComplete: false,
    };
    const metadataProject = {
      ...initialProject,
      managePackageVersionsCentrally: true,
      packageMetadataComplete: true,
    };
    const loadProjectAsync = jest.fn().mockResolvedValue(metadataProject);
    const internals = handler as unknown as {
      projectFileLoader: { loadProjectAsync: typeof loadProjectAsync };
      solutionProjects: Map<string, Project>;
    };
    internals.projectFileLoader = { loadProjectAsync };
    internals.solutionProjects.set(projectPath, initialProject);

    const operationId = 'fast-inventory-cpm-install';
    const completed = waitForCompletion(operationId);
    receiveMessage?.({
      command: 'add-package',
      operationId,
      projectName: projectPath,
      packageId: 'Package.Cpm',
      packageVersion: '2.0.0',
      packageSourceUrl: 'https://packages.example/v3/index.json',
    } as InstallMessage);
    await completed;

    expect(loadProjectAsync).toHaveBeenCalledWith(projectPath);
    expect(messages).toContainEqual({ type: 'project', data: metadataProject });
    const task = (vscode.tasks.executeTask as jest.Mock).mock.calls[0][0] as {
      taskExecution: { args: Array<string | { value: string; quoting: number }> };
    };
    expect(task.taskExecution.args.slice(0, 2)).toEqual(['package', 'add']);
  });

  test('does not edit a project when required metadata cannot be loaded', async () => {
    const initialProject = {
      name: 'Batch',
      fsPath: projectPath,
      packages: [],
      packageMetadataComplete: false,
    };
    const loadProjectAsync = jest.fn().mockRejectedValue(new Error('MSBuild evaluation failed'));
    const internals = handler as unknown as {
      projectFileLoader: { loadProjectAsync: typeof loadProjectAsync };
      solutionProjects: Map<string, Project>;
    };
    internals.projectFileLoader = { loadProjectAsync };
    internals.solutionProjects.set(projectPath, initialProject);

    const operationId = 'fast-inventory-metadata-failure';
    const completed = waitForCompletion(operationId);
    receiveMessage?.({
      command: 'add-package',
      operationId,
      projectName: projectPath,
      packageId: 'Package.Cpm',
      packageVersion: '2.0.0',
      packageSourceUrl: 'https://packages.example/v3/index.json',
    } as InstallMessage);
    await completed;

    expect(vscode.tasks.executeTask).not.toHaveBeenCalled();
    expect(messages.filter((message) => message.type === 'operation-results').pop()).toMatchObject({
      type: 'operation-results',
      data: [expect.objectContaining({ succeeded: false, message: 'MSBuild evaluation failed' })],
    });
  });

  test('restores original files after build failure when the user requests rollback', async () => {
    const testHooks = vscode as unknown as { testHooks: { taskExitCodes: number[] } };
    testHooks.testHooks.taskExitCodes.push(0, 0, 1, 0);
    const batchId = 'failing-build';
    const batchCompleted = waitForCompletion(batchId);
    const request: UpdatePackagesMessage = {
      command: 'update-packages-batch',
      operationId: batchId,
      buildAfterRestore: true,
      updates: [
        {
          projectPaths: [projectPath],
          packageId: 'Package.One',
          packageVersion: '2.0.0',
          packageSourceUrl: 'https://packages.example/v3/index.json',
        },
      ],
    };
    receiveMessage?.(request);
    await batchCompleted;

    const batchResults = messages.filter((message) => message.type === 'operation-results').pop();
    expect(batchResults?.type).toBe('operation-results');
    if (batchResults?.type !== 'operation-results' || !batchResults.rollbackId) {
      throw new Error('A failed build should provide a rollback action.');
    }

    const rollbackId = batchResults.rollbackId;
    const rollbackOperationId = 'rollback-operation';
    const rollbackCompleted = waitForCompletion(rollbackOperationId);
    const rollbackRequest: RollbackPackageUpdateMessage = {
      command: 'rollback-package-update',
      operationId: rollbackOperationId,
      rollbackId,
    };
    receiveMessage?.(rollbackRequest);
    await rollbackCompleted;

    expect(await fs.readFile(projectPath, 'utf8')).toBe('<Project />');
    const rollbackResults = messages.filter((message) => message.type === 'operation-results').pop();
    expect(rollbackResults?.type === 'operation-results' ? rollbackResults.data.at(-1)?.operation : undefined).toBe('rollback');
    expect(rollbackResults?.type === 'operation-results' ? rollbackResults.data.at(-1)?.succeeded : false).toBe(true);
  });

  test('does not roll back files changed after the batch', async () => {
    const testHooks = vscode as unknown as { testHooks: { taskExitCodes: number[] } };
    testHooks.testHooks.taskExitCodes.push(0, 0, 1);
    const operationId = 'user-edit-guard';
    const completed = waitForCompletion(operationId);
    const request: UpdatePackagesMessage = {
      command: 'update-packages-batch',
      operationId,
      buildAfterRestore: true,
      updates: [
        {
          projectPaths: [projectPath],
          packageId: 'Package.One',
          packageVersion: '2.0.0',
          packageSourceUrl: 'https://packages.example/v3/index.json',
        },
      ],
    };
    receiveMessage?.(request);
    await completed;
    const batchResults = messages.filter((message) => message.type === 'operation-results').pop();
    if (batchResults?.type !== 'operation-results' || !batchResults.rollbackId) {
      throw new Error('A failed build should provide a rollback action.');
    }

    await fs.writeFile(projectPath, '<Project UserEdit />');
    const rollbackOperationId = 'guarded-rollback';
    const rollbackCompleted = waitForCompletion(rollbackOperationId);
    const rollbackRequest: RollbackPackageUpdateMessage = {
      command: 'rollback-package-update',
      operationId: rollbackOperationId,
      rollbackId: batchResults.rollbackId,
    };
    receiveMessage?.(rollbackRequest);
    await rollbackCompleted;

    expect(await fs.readFile(projectPath, 'utf8')).toBe('<Project UserEdit />');
    const rollbackResults = messages.filter((message) => message.type === 'operation-results').pop();
    expect(
      rollbackResults?.type === 'operation-results' ? rollbackResults.data.at(-1)?.message : undefined
    ).toContain('changed after the update');
  });

  test('reuses solution inventory across recreated webview handlers without showing a loading phase', async () => {
    const solutionPath = path.join(temporaryDirectory, 'Sample.sln');
    const diagnosticLines: string[] = [];
    const logDiagnostic = (message: string) => diagnosticLines.push(message);
    const project: Project = { name: 'Batch', fsPath: projectPath, packages: [] };
    const solution: Solution = {
      name: 'Sample',
      fsPath: solutionPath,
      projects: [project],
      unsupportedProjects: [],
      loadFailures: [],
    };

    handler.dispose();
    messages = [];
    handler = new WebviewMessageHandler(
      webview as unknown as vscode.Webview,
      { type: 'solution', filePath: solutionPath },
      sessionPackageCache,
      sessionSolutionCache,
      logDiagnostic
    );
    const firstLoader = new SolutionLoader();
    const firstLoad = jest.spyOn(firstLoader, 'loadSolutionAsync').mockResolvedValue(solution);
    (handler as unknown as { solutionLoader: SolutionLoader }).solutionLoader = firstLoader;
    const firstLoadMessage: LoadSolutionMessage = { command: 'load-solution', solutionFilePath: solutionPath };
    receiveMessage?.(firstLoadMessage);
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(firstLoad).toHaveBeenCalledTimes(1);
    expect(messages).toContainEqual({ type: 'solution', data: solution });
    expect(diagnosticLines).toContain('solution-inventory MISS');
    expect(diagnosticLines.some((line) => /^solution-inventory LOAD_COMPLETE, projects=1, retained=true, duration=\d+ms$/.test(line))).toBe(
      true
    );

    handler.dispose();
    messages = [];
    handler = new WebviewMessageHandler(
      webview as unknown as vscode.Webview,
      { type: 'solution', filePath: solutionPath },
      sessionPackageCache,
      sessionSolutionCache,
      logDiagnostic
    );
    const reopenedLoader = new SolutionLoader();
    const reopenedLoad = jest.spyOn(reopenedLoader, 'loadSolutionAsync');
    (handler as unknown as { solutionLoader: SolutionLoader }).solutionLoader = reopenedLoader;
    const reopenMessage: LoadSolutionMessage = { command: 'load-solution', solutionFilePath: solutionPath };
    receiveMessage?.(reopenMessage);

    expect(reopenedLoad).not.toHaveBeenCalled();
    expect(messages).toContainEqual({ type: 'solution', data: solution });
    expect(messages.some((message) => message.type === 'context-loading')).toBe(false);
    expect(diagnosticLines).toContain('solution-inventory HIT, projects=1');
  });

  test('invalidates cached solution inventory after a successful package edit only', async () => {
    const solutionPath = path.join(temporaryDirectory, 'Sample.sln');
    const solution: Solution = {
      name: 'Sample',
      fsPath: solutionPath,
      projects: [],
      unsupportedProjects: [],
      loadFailures: [],
    };
    await sessionSolutionCache.getOrLoad(solutionPath, () => Promise.resolve(solution));
    const postOperationResults = (
      handler as unknown as {
        postOperationResults: (results: PackageOperationResult[], rollbackId?: string, reloadContext?: boolean) => void;
      }
    ).postOperationResults.bind(handler);

    postOperationResults([{ projectPath, packageId: 'Package.Failed', operation: 'add', succeeded: false }], undefined, false);
    expect(sessionSolutionCache.get(solutionPath)).toEqual(solution);

    postOperationResults(
      [{ projectPath, packageId: 'Package.One', operation: 'add', succeeded: true }],
      undefined,
      false
    );
    expect(sessionSolutionCache.get(solutionPath)).toBeUndefined();
  });

  test('reuses cache values across newly created webview message handlers', () => {
    const setMessage: SessionCacheSetMessage = {
      command: 'session-cache-set',
      cacheKind: 'package-summary',
      sourceUrl: 'https://feed.example.test',
      authorizationHeader: 'Bearer test-token',
      keyParts: ['Package.One', false],
      entryKind: 'package-data',
      value: '{"id":"Package.One"}',
    };
    receiveMessage?.(setMessage);

    configureSolutionHandler(path.join(temporaryDirectory, 'Another.sln'), []);
    const getMessage: SessionCacheGetMessage = {
      command: 'session-cache-get',
      requestId: 'request-hit',
      cacheKind: 'package-summary',
      sourceUrl: 'https://feed.example.test',
      authorizationHeader: 'Bearer test-token',
      keyParts: ['Package.One', false],
    };
    receiveMessage?.(getMessage);

    expect(messages).toContainEqual({
      type: 'session-cache-result',
      data: { requestId: 'request-hit', value: '{"id":"Package.One"}' },
    });
  });

  test('returns a cache miss and clears only package data for the requested source', () => {
    receiveMessage?.({
      command: 'session-cache-set',
      cacheKind: 'package-search',
      sourceUrl: 'https://one.example.test',
      keyParts: ['query', false],
      entryKind: 'package-data',
      value: '[]',
    });
    receiveMessage?.({
      command: 'session-cache-set',
      cacheKind: 'service-index',
      sourceUrl: 'https://one.example.test',
      keyParts: [],
      entryKind: 'service-index',
      value: '{"resources":[]}',
    });
    receiveMessage?.({
      command: 'session-cache-set',
      cacheKind: 'package-search',
      sourceUrl: 'https://two.example.test',
      keyParts: ['query', false],
      entryKind: 'package-data',
      value: '[]',
    });
    const clearMessage: SessionCacheClearMessage = {
      command: 'session-cache-clear',
      sourceUrl: 'https://one.example.test',
    };
    receiveMessage?.(clearMessage);

    receiveMessage?.({
      command: 'session-cache-get',
      requestId: 'package-miss',
      cacheKind: 'package-search',
      sourceUrl: 'https://one.example.test',
      keyParts: ['query', false],
    });
    receiveMessage?.({
      command: 'session-cache-get',
      requestId: 'index-hit',
      cacheKind: 'service-index',
      sourceUrl: 'https://one.example.test',
      keyParts: [],
    });
    receiveMessage?.({
      command: 'session-cache-get',
      requestId: 'other-feed-hit',
      cacheKind: 'package-search',
      sourceUrl: 'https://two.example.test',
      keyParts: ['query', false],
    });

    expect(messages).toContainEqual({
      type: 'session-cache-result',
      data: { requestId: 'package-miss', value: null },
    });
    expect(messages).toContainEqual({
      type: 'session-cache-result',
      data: { requestId: 'index-hit', value: '{"resources":[]}' },
    });
    expect(messages).toContainEqual({
      type: 'session-cache-result',
      data: { requestId: 'other-feed-hit', value: '[]' },
    });
  });

  test('reports metadata cache hits, misses and fill duration without logging package or feed identity', () => {
    const diagnosticLines: string[] = [];
    handler.dispose();
    handler = new WebviewMessageHandler(
      webview as unknown as vscode.Webview,
      { type: 'project', filePath: projectPath },
      sessionPackageCache,
      sessionSolutionCache,
      (message) => diagnosticLines.push(message)
    );
    const sourceUrl = 'https://private-feed.example.test/v3/index.json';
    const packageIds = ['Private.Package.One', 'Private.Package.Two'];

    receiveMessage?.({
      command: 'session-cache-get',
      requestId: 'inventory-miss',
      cacheKind: 'package-inventory',
      sourceUrl,
      authorizationHeader: 'Bearer sensitive-token',
      keyParts: ['', false, ...packageIds],
    });

    receiveMessage?.({
      command: 'session-cache-set',
      cacheKind: 'package-inventory',
      sourceUrl,
      authorizationHeader: 'Bearer sensitive-token',
      keyParts: ['', false, ...packageIds],
      entryKind: 'package-data',
      value: '[]',
    });

    receiveMessage?.({
      command: 'session-cache-get',
      requestId: 'inventory-hit',
      cacheKind: 'package-inventory',
      sourceUrl,
      authorizationHeader: 'Bearer sensitive-token',
      keyParts: ['', false, ...packageIds],
    });

    expect(diagnosticLines[0]).toBe('package-inventory MISS, packageIds=2');
    expect(diagnosticLines[1]).toMatch(/^package-inventory STORED, bytes=\d+, miss-to-store=\d+ms$/);
    expect(diagnosticLines[2]).toMatch(/^package-inventory HIT, bytes=2, packageIds=2$/);
    expect(diagnosticLines.join('\n')).not.toContain('private-feed.example.test');
    expect(diagnosticLines.join('\n')).not.toContain('sensitive-token');
    expect(diagnosticLines.join('\n')).not.toContain('Private.Package');
  });

  test('deletes cache entries by their scoped key', () => {
    receiveMessage?.({
      command: 'session-cache-set',
      cacheKind: 'package-summary',
      sourceUrl: 'https://feed.example.test',
      keyParts: ['Package.One', false],
      entryKind: 'package-data',
      value: '{"id":"Package.One"}',
    });
    receiveMessage?.({
      command: 'session-cache-delete',
      cacheKind: 'package-summary',
      sourceUrl: 'https://feed.example.test',
      keyParts: ['Package.One', false],
    });
    receiveMessage?.({
      command: 'session-cache-get',
      requestId: 'deleted-entry',
      cacheKind: 'package-summary',
      sourceUrl: 'https://feed.example.test',
      keyParts: ['Package.One', false],
    });

    expect(messages).toContainEqual({
      type: 'session-cache-result',
      data: { requestId: 'deleted-entry', value: null },
    });
  });

  function configureSolutionHandler(solutionPath: string, projects: Project[]): void {
    handler.dispose();
    messages = [];
    waiters.clear();
    handler = new WebviewMessageHandler(
      webview as unknown as vscode.Webview,
      { type: 'solution', filePath: solutionPath },
      sessionPackageCache,
      sessionSolutionCache
    );
    const privateHandler = handler as unknown as { solutionProjects: Map<string, Project>; loadContext: () => void };
    privateHandler.solutionProjects = new Map(projects.map((project) => [project.fsPath, project]));
    jest.spyOn(privateHandler, 'loadContext').mockImplementation(() => {});
    (vscode.tasks.executeTask as jest.Mock).mockClear();
  }
});
