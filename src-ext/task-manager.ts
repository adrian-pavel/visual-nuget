import * as vscode from 'vscode';

export class TaskManager {
  private readonly currentTasks = new Array<vscode.Task>();
  private readonly taskName = 'visual-nuget';

  constructor(private tasksFinishedCallback: () => void) {
    this.handleFinishedTasks();
  }

  public executeTask(task: vscode.Task): void {
    const hadOtherTasks = this.currentTasks.length > 0;
    this.currentTasks.push(task);
    // no other tasks executing so start this one
    if (!hadOtherTasks) {
      vscode.tasks.executeTask(task);
    }
  }

  private handleFinishedTasks(): void {
    vscode.tasks.onDidEndTask((taskEvent: vscode.TaskEndEvent) => {
      const task = taskEvent.execution.task;
      if (task.name === this.taskName) {
        this.currentTasks.shift();

        // execute the next task in the queue
        if (this.currentTasks.length > 0) {
          vscode.tasks.executeTask(this.currentTasks[0]);
        } else {
          // no more tasks to execute
          this.tasksFinishedCallback();
        }
      }
    });
  }
}
