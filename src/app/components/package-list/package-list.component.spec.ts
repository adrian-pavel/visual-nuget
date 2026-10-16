import { CommonModule } from '@angular/common';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { NO_ERRORS_SCHEMA } from '@angular/core';
import { BehaviorSubject } from 'rxjs';

import { Category } from '../../models/category';
import { PackageRowModel, SolutionProjectPackageState } from '../../models/package-row-model';
import { PackageLevel, Solution } from '../../../../src-common/models/project';
import { ShortNumberPipe } from '../../pipes/short-number.pipe';
import { PackageManagerService } from '../../services/package-manager.service';
import { PackageListComponent } from './package-list.component';

describe('PackageListComponent', () => {
  let fixture: ComponentFixture<PackageListComponent>;
  let category: BehaviorSubject<Category>;
  let packageError: BehaviorSubject<string | null>;
  let contextLoading: BehaviorSubject<{ message: string; completed?: number; total?: number } | null>;

  beforeEach(async () => {
    category = new BehaviorSubject<Category>(Category.Browse);
    packageError = new BehaviorSubject<string | null>(null);
    contextLoading = new BehaviorSubject<{ message: string; completed?: number; total?: number } | null>(null);
    const packageManagerMock = {
      currentPackages: new BehaviorSubject<PackageRowModel[] | null>(null),
      currentPackagesError: packageError,
      contextLoading,
      currentSelectedPackageId: new BehaviorSubject<string | null>(null),
      currentCategory: category,
      currentSolution: new BehaviorSubject<Solution | null>(null),
      installPackages: jest.fn(),
    };

    await TestBed.configureTestingModule({
      declarations: [PackageListComponent, ShortNumberPipe],
      imports: [CommonModule],
      schemas: [NO_ERRORS_SCHEMA],
      providers: [{ provide: PackageManagerService, useValue: packageManagerMock }],
    })
      .compileComponents();

    fixture = TestBed.createComponent(PackageListComponent);
    fixture.detectChanges();
  });

  test('groups Installed packages by direct or transitive usage', () => {
    const directPackage = createPackage('Direct.Package', 'direct');
    const transitivePackage = createPackage('Transitive.Package', 'transitive');
    const mixedSolutionPackage = createPackage('Mixed.Package', 'mixed', [
      createProjectState(true, 'direct'),
      createProjectState(true, 'transitive'),
    ]);
    const transitiveSolutionPackage = createPackage('Solution.Transitive', 'transitive', [
      createProjectState(true, 'transitive'),
      createProjectState(false, undefined),
    ]);
    const unknownPackage = createPackage('Unknown.Package', 'unknown', [createProjectState(true, 'unknown')]);

    fixture.componentInstance.packages = [
      directPackage,
      transitivePackage,
      mixedSolutionPackage,
      transitiveSolutionPackage,
      unknownPackage,
    ];
    category.next(Category.Installed);

    expect(fixture.componentInstance.showTransitivePackages).toBe(true);
    expect(fixture.componentInstance.topLevelPackages).toEqual([directPackage, mixedSolutionPackage, unknownPackage]);
    expect(fixture.componentInstance.transitivePackages).toEqual([transitivePackage, transitiveSolutionPackage]);
  });

  test('does not group Browse packages', () => {
    expect(fixture.componentInstance.showTransitivePackages).toBe(false);
  });

  test('shows bulk update selection in solution mode', () => {
    fixture.componentInstance.packages = [createPackage('Direct.Package', 'direct')];
    fixture.componentInstance.isSolution = true;
    category.next(Category.Updates);

    expect(fixture.componentInstance.showSelectCheckboxes).toBe(true);
  });

  test('renders package source errors instead of a permanent loading spinner', () => {
    const error = 'Packages could not be loaded from the selected source. Check the source settings or connection, then refresh.';
    packageError.next(error);
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('[role="alert"]')?.textContent.trim()).toBe(error);
    expect(fixture.nativeElement.querySelector('app-loading-spinner')).toBeNull();
  });

  test('does not show an empty result while the solution is loading', () => {
    contextLoading.next({ message: 'Loading solution projects (2 of 8)...', completed: 2, total: 8 });
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('.no-packages')).toBeNull();
  });
});

function createPackage(
  id: string,
  packageLevel: PackageLevel,
  solutionProjectStates?: SolutionProjectPackageState[]
): PackageRowModel {
  return {
    id,
    version: '1.0.0',
    description: '',
    authors: [],
    iconUrl: '',
    totalDownloads: undefined,
    verified: false,
    installedVersion: '1.0.0',
    isInstalled: true,
    isOutdated: false,
    sourceUrl: '',
    packageLevel,
    versions: undefined,
    solutionProjectStates,
  };
}

function createProjectState(isInstalled: boolean, packageLevel: PackageLevel | undefined): SolutionProjectPackageState {
  return {
    projectPath: 'project.csproj',
    projectName: 'project',
    isInstalled,
    installedVersion: isInstalled ? '1.0.0' : '',
    packageLevel,
  };
}
