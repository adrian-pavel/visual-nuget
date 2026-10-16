import { Component, OnInit, ChangeDetectionStrategy } from '@angular/core';
import { PackageOperationResult } from '../../../../src-common/models/extension-message';
import { PackageManagerService } from '../../services/package-manager.service';
import { BaseComponent } from '../base-component';

@Component({
  selector: 'app-package-operation-dialog',
  templateUrl: './package-operation-dialog.component.html',
  styleUrls: ['./package-operation-dialog.component.scss'],
  changeDetection: ChangeDetectionStrategy.Eager,
  standalone: false,
})
export class PackageOperationDialogComponent extends BaseComponent implements OnInit {
  public isBusy = false;
  public progressMessage: string | null = null;
  public operationResults: PackageOperationResult[] = [];
  public rollbackId: string | null = null;

  constructor(private readonly packageManager: PackageManagerService) {
    super();
  }

  public ngOnInit(): void {
    this.subscriptions.add(
      this.packageManager.packageOperationInProgress.subscribe((isBusy) => {
        this.isBusy = isBusy;
      })
    );
    this.subscriptions.add(
      this.packageManager.packageOperationProgress.subscribe((message) => {
        this.progressMessage = message;
      })
    );
    this.subscriptions.add(
      this.packageManager.operationResults.subscribe((results) => {
        this.operationResults = results;
      })
    );
    this.subscriptions.add(
      this.packageManager.rollbackId.subscribe((rollbackId) => {
        this.rollbackId = rollbackId;
      })
    );
  }

  public get successfulOperationCount(): number {
    return this.operationResults.filter((result) => result.succeeded && !result.skipped).length;
  }

  public get failedOperationCount(): number {
    return this.operationResults.filter((result) => !result.succeeded && !result.skipped).length;
  }

  public get skippedOperationCount(): number {
    return this.operationResults.filter((result) => result.skipped).length;
  }

  public get packageChangeResults(): PackageOperationResult[] {
    return this.operationResults.filter(
      (result) =>
        (result.operation === 'add' || result.operation === 'remove') &&
        result.packageId !== '(batch)' &&
        result.packageId !== '(rollback)'
    );
  }

  public get failureDetails(): PackageOperationResult[] {
    const packageChanges = new Set(this.packageChangeResults);
    return this.operationResults.filter(
      (result) => (!result.succeeded || result.skipped) && !packageChanges.has(result)
    );
  }

  public get resultHeading(): string {
    if (this.failedOperationCount > 0) {
      return 'Package changes finished with issues';
    }
    return this.skippedOperationCount > 0 ? 'Package changes completed with skipped items' : 'Package changes complete';
  }

  public versionTransition(result: PackageOperationResult): string {
    const fromVersion = result.fromVersion
      ? `${result.packageId} ${result.fromVersion}`
      : result.operation === 'add'
        ? '—'
        : result.packageId;
    const toVersion = result.toVersion
      ? `${result.packageId} ${result.toVersion}`
      : result.operation === 'remove'
        ? '—'
        : result.packageId;
    return `${fromVersion} → ${toVersion}`;
  }

  public statusLabel(result: PackageOperationResult): string {
    return result.skipped ? 'Skipped' : result.succeeded ? 'Succeeded' : 'Failed';
  }

  public rollbackPackageUpdate(): void {
    if (!this.isBusy && this.rollbackId) {
      this.packageManager.rollbackPackageUpdate(this.rollbackId);
    }
  }

  public dismissResults(): void {
    if (!this.isBusy) {
      this.packageManager.dismissOperationResults();
    }
  }
}
