import { Component, HostListener, ChangeDetectionStrategy, OnDestroy } from '@angular/core';
import { Subscription } from 'rxjs';

import { ExtensionMessage } from '../../src-common/models/extension-message';
import { PackageSource } from '../../src-common/models/package-source';
import { Project, Solution } from '../../src-common/models/project';
import { ContextLoadingState, PackageManagerService } from './services/package-manager.service';

@Component({
    selector: 'app-root',
    templateUrl: './app.component.html',
    styleUrls: ['./app.component.scss'],
    changeDetection: ChangeDetectionStrategy.Eager,
    standalone: false
})
export class AppComponent implements OnDestroy {
  public contextLoading: ContextLoadingState | null = null;
  public packageQueryLoading = false;
  private readonly subscriptions = new Subscription();

  constructor(private packageManager: PackageManagerService) {
    this.subscriptions.add(this.packageManager.contextLoading.subscribe((state) => (this.contextLoading = state)));
    this.subscriptions.add(this.packageManager.packageQueryLoading.subscribe((loading) => (this.packageQueryLoading = loading)));
  }

  public get showLoadingOverlay(): boolean {
    return (!!this.contextLoading && !this.contextLoading.error) || this.packageQueryLoading;
  }

  public get isContextLoading(): boolean {
    return !!this.contextLoading && !this.contextLoading.error;
  }

  public get loadingMessage(): string {
    return this.contextLoading && !this.contextLoading.error
      ? this.contextLoading.message
      : 'Loading package information from the selected source...';
  }

  public ngOnDestroy(): void {
    this.subscriptions.unsubscribe();
  }

  @HostListener('window:message', ['$event'])
  MessageFromExtension(event: MessageEvent<ExtensionMessage>) {
    const message = event.data;
    if (message.type === 'project') {
      this.packageManager.changeCurrentProject(message.data as Project);
    } else if (message.type === 'solution') {
      this.packageManager.changeCurrentSolution(message.data as Solution);
    } else if (message.type === 'context-loading') {
      this.packageManager.setContextLoading(message.data.message, message.data.completed, message.data.total);
    } else if (message.type === 'context-load-error') {
      this.packageManager.setContextLoadError(message.data.message);
    } else if (message.type === 'sources') {
      this.packageManager.changeCurrentSources(message.data as PackageSource[]);
    } else if (message.type === 'operation-results') {
      this.packageManager.setOperationResults(message.data, message.rollbackId);
    } else if (message.type === 'operation-progress') {
      this.packageManager.setPackageOperationProgress(message.data.operationId, message.data.message);
    } else if (message.type === 'operation-completed') {
      this.packageManager.completePackageOperation(message.data.operationId);
    }
  }
}
