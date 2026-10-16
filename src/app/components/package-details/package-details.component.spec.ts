import { CommonModule } from '@angular/common';
import { FormsModule, ReactiveFormsModule } from '@angular/forms';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { NO_ERRORS_SCHEMA } from '@angular/core';
import { BehaviorSubject } from 'rxjs';

import { CatalogEntry } from '../../models/package-meta';
import { PackageRowModel } from '../../models/package-row-model';
import { Solution } from '../../../../src-common/models/project';
import { SeverityPipe } from '../../pipes/severity.pipe';
import { PackageManagerService } from '../../services/package-manager.service';
import { PackageDetailsVulnerabilitiesComponent } from '../package-details-vulnerabilities/package-details-vulnerabilities.component';
import { PackageDetailsComponent } from './package-details.component';

describe('PackageDetailsComponent', () => {
  let fixture: ComponentFixture<PackageDetailsComponent>;
  let selectedPackage: BehaviorSubject<PackageRowModel | null>;
  let selectedPackageId: BehaviorSubject<string | null>;
  let selectedPackageError: BehaviorSubject<string | null>;
  let currentSolution: BehaviorSubject<Solution | null>;
  let packageManagerMock: {
    currentSelectedPackage: BehaviorSubject<PackageRowModel | null>;
    currentSelectedPackageId: BehaviorSubject<string | null>;
    currentSelectedPackageError: BehaviorSubject<string | null>;
    currentSolution: BehaviorSubject<Solution | null>;
    selectedProjectsForPackage: jest.Mock;
    selectProjectsForPackage: jest.Mock;
    isPackageOperationInProgress: boolean;
    installPackage: jest.Mock;
    uninstallPackage: jest.Mock;
  };

  beforeEach(async () => {
    selectedPackage = new BehaviorSubject<PackageRowModel | null>(null);
    selectedPackageId = new BehaviorSubject<string | null>(null);
    selectedPackageError = new BehaviorSubject<string | null>(null);
    currentSolution = new BehaviorSubject<Solution | null>(null);
    packageManagerMock = {
      currentSelectedPackage: selectedPackage,
      currentSelectedPackageId: selectedPackageId,
      currentSelectedPackageError: selectedPackageError,
      currentSolution,
      selectedProjectsForPackage: jest.fn(() => []),
      selectProjectsForPackage: jest.fn(),
      isPackageOperationInProgress: false,
      installPackage: jest.fn(),
      uninstallPackage: jest.fn(),
    };

    await TestBed.configureTestingModule({
      declarations: [PackageDetailsComponent, PackageDetailsVulnerabilitiesComponent, SeverityPipe],
      imports: [CommonModule, FormsModule, ReactiveFormsModule],
      schemas: [NO_ERRORS_SCHEMA],
      providers: [{ provide: PackageManagerService, useValue: packageManagerMock }],
    })
      .compileComponents();

    fixture = TestBed.createComponent(PackageDetailsComponent);
    fixture.detectChanges();
  });

  test('shows loading while package details are pending', () => {
    selectedPackageId.next('Example.Package');
    expect(fixture.componentInstance.isLoading).toBe(true);

    selectedPackage.next(createPackage());
    expect(fixture.componentInstance.isLoading).toBe(false);

    selectedPackageId.next(null);
    selectedPackage.next(null);
    expect(fixture.componentInstance.isLoading).toBe(false);
  });

  test('project install forwards the chosen version to the package manager', () => {
    const packageRow = createPackage([createCatalogEntry('2.0.0')]);
    selectedPackage.next(packageRow);

    fixture.componentInstance.install();

    expect(packageManagerMock.installPackage).toHaveBeenCalledWith(packageRow, '2.0.0');
  });

  test('solution selection and package actions forward selected projects and CPM exceptions', () => {
    const packageRow = createPackage([createCatalogEntry('2.0.0')]);
    packageRow.solutionProjectStates = [
      {
        projectPath: 'ProjectA.csproj',
        projectName: 'Project A',
        isInstalled: true,
        isDirectlyInstalled: true,
        installedVersion: '1.0.0',
        versionSource: 'central',
        managePackageVersionsCentrally: true,
        packageLevel: 'direct',
      },
      {
        projectPath: 'ProjectB.csproj',
        projectName: 'Project B',
        isInstalled: true,
        isDirectlyInstalled: true,
        installedVersion: '1.1.0',
        versionSource: 'override',
        managePackageVersionsCentrally: true,
        packageLevel: 'direct',
      },
    ];
    currentSolution.next({
      name: 'Sample.sln',
      fsPath: 'Sample.sln',
      projects: [],
      unsupportedProjects: [],
      loadFailures: [],
    });
    selectedPackage.next(packageRow);
    fixture.detectChanges();

    fixture.componentInstance.toggleProject('ProjectA.csproj', true);
    fixture.componentInstance.toggleAllProjects(true);
    expect(fixture.componentInstance.allProjectsSelected).toBe(true);
    expect(fixture.componentInstance.hasCpmExceptions).toBe(true);
    expect(fixture.componentInstance.hasSelectedCentralVersion).toBe(true);
    expect(fixture.componentInstance.hasSelectedDirectPackage).toBe(true);

    fixture.componentInstance.includeCpmExceptions = true;
    fixture.componentInstance.install();
    expect(packageManagerMock.installPackage).toHaveBeenCalledWith(
      packageRow,
      '2.0.0',
      ['ProjectA.csproj', 'ProjectB.csproj'],
      true
    );

    fixture.componentInstance.toggleProject('ProjectB.csproj', false);
    expect(packageManagerMock.selectProjectsForPackage).toHaveBeenLastCalledWith('Example.Package', ['ProjectA.csproj']);
    fixture.componentInstance.uninstall();
    expect(packageManagerMock.uninstallPackage).toHaveBeenCalledWith(packageRow, ['ProjectA.csproj']);
  });

  test('renders a source error instead of keeping the details spinner active', () => {
    selectedPackageId.next('Example.Package');
    selectedPackageError.next('Package details could not be loaded. Retry.');
    fixture.detectChanges();

    expect(fixture.componentInstance.isLoading).toBe(false);
    expect(fixture.nativeElement.querySelector('[role="alert"]')?.textContent.trim()).toBe(
      'Package details could not be loaded. Retry.'
    );
    expect(fixture.nativeElement.querySelector('app-loading-spinner')).toBeNull();
  });

  test('shows latest search warnings only while that latest version is selected', () => {
    const selectedVersion: CatalogEntry = {
      '@id': 'https://packages.example.test/widget/1.2.3.json',
      id: 'Widget.Package',
      version: '1.2.3',
      description: 'Widget support',
      authors: ['Ada'],
      iconUrl: '',
      licenseUrl: '',
      projectUrl: '',
      tags: [],
      dependencyGroups: [],
      published: '2025-01-01T00:00:00Z',
      listed: true,
    };
    const packageRow = createPackage([selectedVersion]);
    packageRow.version = selectedVersion.version;
    packageRow.vulnerabilities = [{ advisoryUrl: 'https://advisories.example.test/CVE-1', severity: 3 }];
    packageRow.deprecation = {
      message: 'Use Widget.Next.',
      reasons: ['Legacy'],
      alternatePackage: { id: 'Widget.Next', range: '[2.0.0, )' },
    };
    selectedPackage.next(packageRow);
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('[aria-label="Known package vulnerabilities"]')?.textContent).toContain(
      'Vulnerabilities detected (1)'
    );
    const deprecation = fixture.nativeElement.querySelector('[aria-label="Package deprecation"]') as HTMLElement;
    expect(deprecation.textContent).toContain('Use Widget.Next.');
    expect(deprecation.textContent).toContain('Widget.Next');

    fixture.componentInstance.selectedVersion.setValue({ ...selectedVersion, version: '1.0.0' });
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('[aria-label="Known package vulnerabilities"]')).toBeNull();
    expect(fixture.nativeElement.querySelector('[aria-label="Package deprecation"]')).toBeNull();
  });

  test('labels vulnerable and deprecated versions in the version dropdown', () => {
    const versions = [
      createCatalogEntry('3.0.0'),
      { ...createCatalogEntry('2.0.0'), vulnerabilities: [{ advisoryUrl: 'https://advisories.example.test/CVE-2', severity: 2 }] },
      { ...createCatalogEntry('1.5.0'), deprecation: { reasons: ['Legacy'] } },
      {
        ...createCatalogEntry('1.0.0'),
        vulnerabilities: [{ advisoryUrl: 'https://advisories.example.test/CVE-1', severity: 3 }],
        deprecation: { reasons: ['Legacy'] },
      },
    ];
    selectedPackage.next(createPackage(versions));
    fixture.detectChanges();

    const options = Array.from(fixture.nativeElement.querySelectorAll('select.drop-down option')) as HTMLOptionElement[];
    expect(options.map((option) => option.textContent?.trim())).toEqual([
      '3.0.0',
      '2.0.0 ⚠️ Vulnerable',
      '1.5.0 ⚠️ Deprecated',
      '1.0.0 ⚠️ Vulnerable, Deprecated',
    ]);
  });
});

function createPackage(versions: CatalogEntry[] = []): PackageRowModel {
  return {
    id: 'Example.Package',
    version: '1.0.0',
    description: '',
    authors: [],
    iconUrl: '',
    totalDownloads: undefined,
    verified: false,
    installedVersion: '',
    isInstalled: false,
    isOutdated: false,
    sourceUrl: '',
    versions,
  };
}

function createCatalogEntry(version: string): CatalogEntry {
  return {
    '@id': `https://packages.example.test/widget/${version}.json`,
    id: 'Example.Package',
    version,
    description: 'Widget support',
    authors: ['Ada'],
    iconUrl: '',
    licenseUrl: '',
    projectUrl: '',
    tags: [],
    dependencyGroups: [],
    published: '2025-01-01T00:00:00Z',
    listed: true,
  };
}
