import { ExtensionMessage } from '../../src-common/models/extension-message';
import { PackageSource } from '../../src-common/models/package-source';
import { InstallMessage, UIMessage, UninstallMessage } from '../../src-common/models/ui-message';
import * as vscode from 'vscode';

import ProjectFileLoader from './project-file-loader';
import { TaskManager } from './task-manager';

export default class WebviewMessageHandler {
  private readonly disposables: vscode.Disposable[] = [];
  private readonly projectFileLoader: ProjectFileLoader;
  private readonly taskManager: TaskManager;
  private readonly taskName = 'visual-nuget';

  public constructor(private readonly webview: vscode.Webview, private readonly projectFilePath: string) {
    this.projectFileLoader = new ProjectFileLoader();
    this.taskManager = new TaskManager(() => this.loadProject());

    this.webview.onDidReceiveMessage(
      (message: UIMessage) => {
        this.handleMessage(message);
      },
      null,
      this.disposables
    );

    vscode.workspace.onDidChangeConfiguration(
      () => {
        this.loadConfiguration();
      },
      null,
      this.disposables
    );
  }

  private handleMessage(message: UIMessage): void {
    switch (message.command) {
      case 'add-package':
        this.addPackage(message as InstallMessage);
        return;
      case 'remove-package':
        this.removePackage(message as UninstallMessage);
        return;
      case 'load-project':
        this.loadProject();
        this.loadConfiguration();
        return;
      case 'open-settings':
        this.openSettings();
    }
  }

  private addPackage(message: InstallMessage): void {
    const args = [
      'add',
      { value: message.projectName, quoting: vscode.ShellQuoting.Strong },
      'package',
      message.packageId,
      '-v',
      message.packageVersion,
      '-s',
      message.packageSourceUrl,
      '--interactive',
    ];

    const task = new vscode.Task(
      { type: 'dotnet', task: `add` },
      vscode.TaskScope.Workspace,
      this.taskName,
      'dotnet',
      new vscode.ShellExecution('dotnet', args)
    );
    this.taskManager.executeTask(task);
  }

  private removePackage(message: UninstallMessage): void {
    const args = ['remove', { value: message.projectName, quoting: vscode.ShellQuoting.Strong }, 'package', message.packageId];

    const task = new vscode.Task(
      { type: 'dotnet', task: `remove` },
      vscode.TaskScope.Workspace,
      this.taskName,
      'dotnet',
      new vscode.ShellExecution('dotnet', args)
    );
    this.taskManager.executeTask(task);
  }

  private loadProject(): void {
    this.projectFileLoader.loadProjectAsync(this.projectFilePath).then((project) => {
      const message: ExtensionMessage = { type: 'project', data: project };
      this.webview.postMessage(message);
    });
  }

  private loadConfiguration(): void {
    const configuration = vscode.workspace.getConfiguration('VisualNuGet');
    try {
      const sourcesStrings = configuration['sources'];

      const sources = [];

      for (const sourceSt of sourcesStrings) {
        const source = JSON.parse(sourceSt) as PackageSource;
        sources.push(source);
      }

      const message: ExtensionMessage = { type: 'sources', data: sources };

      this.webview.postMessage(message);
    } catch (error) {
      vscode.window.showErrorMessage(`Error parsing Visual NuGet settings: ${error}`);
    }
  }

  private openSettings(): void {
    vscode.commands.executeCommand('workbench.action.openSettings', '@ext:fullstackspider.visual-nuget');
  }

  public dispose(): void {
    while (this.disposables.length) {
      const disposable = this.disposables.pop();
      if (disposable) {
        disposable.dispose();
      }
    }
  }
}
