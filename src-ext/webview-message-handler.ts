import * as vscode from 'vscode';
import { InstallMessage, UIMessage, UninstallMessage } from './models/ui-message';

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
      this.webview.postMessage({ type: 'project', data: project });
    });
  }

  private loadConfiguration(): void {
    const configuration = vscode.workspace.getConfiguration('VisualNuGet');
    try {
      const sourcesStrings = configuration['sources'];

      const sources = [];

      for (const sourceSt of sourcesStrings) {
        const source = JSON.parse(sourceSt);
        sources.push(source);
      }

      this.webview.postMessage({ type: 'sources', data: sources });
    } catch (error) {
      vscode.window.showErrorMessage(`Error parsing Visual NuGet settings: ${error}`);
    }
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
