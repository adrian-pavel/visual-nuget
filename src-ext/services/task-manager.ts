import * as vscode from 'vscode';

interface QueuedTask {
  task: vscode.Task;
  resolve: (result: TaskResult) => void;
}

export interface TaskResult {
  exitCode?: number;
  error?: string;
}

export class TaskManager implements vscode.Disposable {
  private readonly queue: QueuedTask[] = [];
  private readonly endTaskProcessSubscription: vscode.Disposable;
  private isRunning = false;
  private completionCallbackSuppression = 0;

  public constructor(private readonly tasksFinishedCallback: () => void) {
    this.endTaskProcessSubscription = vscode.tasks.onDidEndTaskProcess((event) => {
      if (this.queue[0]?.task !== event.execution.task) {
        return;
      }

      this.completeCurrentTask({ exitCode: event.exitCode });
    });
  }

  public executeTask(task: vscode.Task): Promise<TaskResult> {
    const promise = new Promise<TaskResult>((resolve) => {
      this.queue.push({ task, resolve });
    });

    if (!this.isRunning && this.queue.length === 1) {
      this.startNextTask();
    }

    return promise;
  }

  public async executeBatch<T>(operation: () => Promise<T>): Promise<T> {
    this.completionCallbackSuppression++;
    try {
      return await operation();
    } finally {
      this.completionCallbackSuppression--;
      this.notifyTasksFinishedIfIdle();
    }
  }

  public dispose(): void {
    this.endTaskProcessSubscription.dispose();
  }

  private startNextTask(): void {
    const queuedTask = this.queue[0];
    if (!queuedTask) {
      return;
    }

    this.isRunning = true;
    void Promise.resolve(vscode.tasks.executeTask(queuedTask.task)).then(
      () => undefined,
      (error: unknown) => {
        if (this.queue[0] === queuedTask) {
          this.completeCurrentTask({ error: error instanceof Error ? error.message : String(error) });
        }
      }
    );
  }

  private completeCurrentTask(result: TaskResult): void {
    const completedTask = this.queue.shift();
    this.isRunning = false;
    completedTask?.resolve(result);

    if (this.queue.length > 0) {
      this.startNextTask();
    } else {
      this.notifyTasksFinishedIfIdle();
    }
  }

  private notifyTasksFinishedIfIdle(): void {
    if (!this.isRunning && this.queue.length === 0 && this.completionCallbackSuppression === 0) {
      this.tasksFinishedCallback();
    }
  }
}
