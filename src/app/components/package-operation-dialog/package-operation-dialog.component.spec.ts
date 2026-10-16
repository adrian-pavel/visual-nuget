import { ComponentFixture, TestBed } from '@angular/core/testing';
import { BehaviorSubject } from 'rxjs';
import { PackageOperationResult } from '../../../../src-common/models/extension-message';
import { PackageManagerService } from '../../services/package-manager.service';
import { LoadingSpinnerComponent } from '../loading-spinner/loading-spinner.component';
import { PackageOperationDialogComponent } from './package-operation-dialog.component';

describe('PackageOperationDialogComponent', () => {
  let fixture: ComponentFixture<PackageOperationDialogComponent>;
  let operationInProgress: BehaviorSubject<boolean>;
  let operationProgress: BehaviorSubject<string | null>;
  let operationResults: BehaviorSubject<PackageOperationResult[]>;
  let rollbackId: BehaviorSubject<string | null>;
  let packageManagerMock: {
    packageOperationInProgress: BehaviorSubject<boolean>;
    packageOperationProgress: BehaviorSubject<string | null>;
    operationResults: BehaviorSubject<PackageOperationResult[]>;
    rollbackId: BehaviorSubject<string | null>;
    rollbackPackageUpdate: jest.Mock;
    dismissOperationResults: jest.Mock;
  };

  beforeEach(async () => {
    operationInProgress = new BehaviorSubject(false);
    operationProgress = new BehaviorSubject<string | null>(null);
    operationResults = new BehaviorSubject<PackageOperationResult[]>([]);
    rollbackId = new BehaviorSubject<string | null>(null);
    packageManagerMock = {
      packageOperationInProgress: operationInProgress,
      packageOperationProgress: operationProgress,
      operationResults,
      rollbackId,
      rollbackPackageUpdate: jest.fn(),
      dismissOperationResults: jest.fn(),
    };

    await TestBed.configureTestingModule({
      declarations: [PackageOperationDialogComponent, LoadingSpinnerComponent],
      providers: [{ provide: PackageManagerService, useValue: packageManagerMock }],
    }).compileComponents();

    fixture = TestBed.createComponent(PackageOperationDialogComponent);
    fixture.detectChanges();
  });

  test('blocks the webview and shows operation progress', () => {
    operationInProgress.next(true);
    operationProgress.next('Restoring packages…');
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('.operation-backdrop')).not.toBeNull();
    expect(fixture.nativeElement.textContent).toContain('Applying package changes');
    expect(fixture.nativeElement.textContent).toContain('Restoring packages…');
    expect(fixture.nativeElement.querySelectorAll('button')).toHaveLength(0);
  });

  test('shows operation counts, failure details, and the guarded rollback action', () => {
    operationResults.next([
      {
        projectPath: 'App.csproj',
        packageId: 'Package.A',
        operation: 'add',
        succeeded: true,
        fromVersion: '1.1',
        toVersion: '1.4',
      },
      {
        projectPath: 'App.csproj',
        packageId: 'Package.D',
        operation: 'add',
        succeeded: false,
        fromVersion: '5.3',
        toVersion: '5.6',
        message: 'The package version could not be applied.',
      },
      {
        projectPath: 'App.csproj',
        packageId: 'Package.F',
        operation: 'add',
        succeeded: true,
        fromVersion: '1.6',
        toVersion: '1.9',
      },
      {
        projectPath: 'App.csproj',
        packageId: '(batch)',
        operation: 'restore',
        succeeded: false,
        message: 'dotnet restore exited with code 1.',
      },
      {
        projectPath: 'App.csproj',
        packageId: '(batch)',
        operation: 'build',
        succeeded: false,
        skipped: true,
        message: 'Build was skipped.',
      },
    ]);
    rollbackId.next('rollback-id');
    fixture.detectChanges();

    const summary = fixture.nativeElement.querySelectorAll('.summary-item') as NodeListOf<HTMLElement>;
    expect(summary[0].querySelector('strong')?.textContent).toBe('2');
    expect(summary[0].textContent).toContain('Succeeded');
    expect(summary[1].querySelector('strong')?.textContent).toBe('2');
    expect(summary[1].textContent).toContain('Failed');
    expect(summary[2].querySelector('strong')?.textContent).toBe('1');
    expect(summary[2].textContent).toContain('Skipped');
    expect(fixture.nativeElement.textContent).toContain('dotnet restore exited with code 1.');
    expect(fixture.nativeElement.textContent).toContain('Interactive sign-in prompts are disabled');

    const packageRows = fixture.nativeElement.querySelectorAll('.package-change-row') as NodeListOf<HTMLElement>;
    expect(packageRows).toHaveLength(3);
    expect(packageRows[0].textContent).toContain('Package.A 1.1 → Package.A 1.4');
    expect(packageRows[0].querySelector('.status-icon')?.textContent?.trim()).toBe('✓');
    expect(packageRows[0].querySelector('.status-icon')?.classList.contains('is-success')).toBe(true);
    expect(packageRows[1].textContent).toContain('Package.D 5.3 → Package.D 5.6');
    expect(packageRows[1].querySelector('.status-icon')?.textContent?.trim()).toBe('✕');
    expect(packageRows[1].querySelector('.status-icon')?.classList.contains('is-failure')).toBe(true);
    expect(packageRows[1].textContent).toContain('The package version could not be applied.');
    expect(packageRows[1].textContent).toContain('Failure details');
    expect(packageRows[2].textContent).toContain('Package.F 1.6 → Package.F 1.9');
    expect(packageRows[2].querySelector('.status-icon')?.classList.contains('is-success')).toBe(true);
    expect(fixture.nativeElement.textContent).toContain('Failure details');

    const rollbackButton = fixture.nativeElement.querySelector('button:not(.secondary)') as HTMLButtonElement;
    rollbackButton.click();
    expect(packageManagerMock.rollbackPackageUpdate).toHaveBeenCalledWith('rollback-id');

    const keepChangesButton = fixture.nativeElement.querySelector('.secondary') as HTMLButtonElement;
    keepChangesButton.click();
    expect(packageManagerMock.dismissOperationResults).toHaveBeenCalledTimes(1);
  });
});
