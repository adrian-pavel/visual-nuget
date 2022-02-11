import * as vscode from 'vscode';

import ProjectFileLoader from './project-file-loader';

export default class WebviewMessageHandler {
  private readonly disposables: vscode.Disposable[] = [];
  private readonly projectFileLoader: ProjectFileLoader;
  private readonly taskName = 'visual-nuget';

  public constructor(private readonly webview: vscode.Webview, private readonly projectName: string) {
    this.projectFileLoader = new ProjectFileLoader();

    this.webview.onDidReceiveMessage(
      (message: any) => {
        this.handleMessage(message);
      },
      null,
      this.disposables
    );

    this.handleFinishedTasks();
  }

  private handleFinishedTasks(): void {
    vscode.tasks.onDidEndTask((taskEvent: vscode.TaskEndEvent) => {
      const task = taskEvent.execution.task;
      if (task.name === this.taskName) {
        this.loadProject();
      }
    });
  }

  private handleMessage(message: any): void {
    switch (message.command) {
      case 'add-package':
        this.addPackage(message);
        return;
      case 'remove-package':
        this.removePackage(message);
        return;
      case 'load-project':
        this.loadProject();
        this.loadConfiguration();
        return;
    }
  }

  private addPackage(message: any): void {
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
    vscode.tasks.executeTask(task).then();
  }

  private removePackage(message: any): void {
    const args = ['remove', { value: message.projectName, quoting: vscode.ShellQuoting.Strong }, 'package', message.packageId];

    const task = new vscode.Task(
      { type: 'dotnet', task: `remove` },
      vscode.TaskScope.Workspace,
      this.taskName,
      'dotnet',
      new vscode.ShellExecution('dotnet', args)
    );
    vscode.tasks.executeTask(task).then();
  }

  private loadProject(): void {
    this.projectFileLoader.loadProjectAsync(this.projectName).then((project) => {
      this.webview.postMessage({ type: 'project', data: project });
    });
  }

  private loadConfiguration(): void {
    let configuration = vscode.workspace.getConfiguration('VisualNuGet');
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
