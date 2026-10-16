import { CommonModule } from '@angular/common';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { NO_ERRORS_SCHEMA } from '@angular/core';

import { PackageRowModel } from '../../models/package-row-model';
import { ShortNumberPipe } from '../../pipes/short-number.pipe';
import { PackageManagerService } from '../../services/package-manager.service';
import { PackageRowComponent } from './package-row.component';

describe('PackageRowComponent', () => {
  let fixture: ComponentFixture<PackageRowComponent>;
  let packageManagerMock: {
    isPackageOperationInProgress: boolean;
    installPackage: jest.Mock;
    uninstallPackage: jest.Mock;
    changeCurrentSelectedPackage: jest.Mock;
  };

  beforeEach(async () => {
    packageManagerMock = {
      isPackageOperationInProgress: false,
      installPackage: jest.fn(),
      uninstallPackage: jest.fn(),
      changeCurrentSelectedPackage: jest.fn(),
    };

    await TestBed.configureTestingModule({
      declarations: [PackageRowComponent, ShortNumberPipe],
      imports: [CommonModule],
      schemas: [NO_ERRORS_SCHEMA],
      providers: [{ provide: PackageManagerService, useValue: packageManagerMock }],
    }).compileComponents();

    fixture = TestBed.createComponent(PackageRowComponent);
    fixture.componentInstance.package = createPackage();
  });

  test('renders separate accessible warnings for vulnerable and deprecated result versions', () => {
    fixture.detectChanges();

    const vulnerabilityWarning = fixture.nativeElement.querySelector(
      '[aria-label="Known vulnerabilities in version 2.0.0"]'
    );
    const deprecationWarning = fixture.nativeElement.querySelector('[aria-label="Version 2.0.0 is deprecated"]');
    expect(vulnerabilityWarning).not.toBeNull();
    expect(deprecationWarning).not.toBeNull();
    expect(packageManagerMock.installPackage).not.toHaveBeenCalled();
    expect(packageManagerMock.uninstallPackage).not.toHaveBeenCalled();
  });

  test('renders no warning when the selected result has no warning metadata', () => {
    fixture.componentInstance.package = {
      ...createPackage(),
      vulnerabilities: undefined,
      deprecation: undefined,
    };
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('.package-warning-icon')).toBeNull();
    expect(fixture.nativeElement.textContent).toContain('Widget.Package');
  });
});

function createPackage(): PackageRowModel {
  return {
    id: 'Widget.Package',
    version: '2.0.0',
    description: 'Widget support',
    authors: ['Ada'],
    iconUrl: '',
    totalDownloads: 1,
    verified: false,
    vulnerabilities: [{ advisoryUrl: 'https://advisories.example.test/CVE-1', severity: 3 }],
    deprecation: { message: 'Use Widget.Next.', reasons: ['Legacy'] },
    installedVersion: '',
    isInstalled: false,
    isOutdated: false,
    sourceUrl: 'https://packages.example.test/v3/index.json',
    versions: undefined,
  };
}
