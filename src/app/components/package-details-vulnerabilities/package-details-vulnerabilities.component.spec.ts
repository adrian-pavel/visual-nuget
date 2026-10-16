import { CommonModule } from '@angular/common';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { NO_ERRORS_SCHEMA } from '@angular/core';

import { PackageDeprecation, Vulnerability } from 'src/app/models/package-meta';
import { SeverityPipe } from '../../pipes/severity.pipe';
import { PackageDetailsVulnerabilitiesComponent } from './package-details-vulnerabilities.component';

describe('PackageDetailsVulnerabilitiesComponent', () => {
  let component: PackageDetailsVulnerabilitiesComponent;
  let fixture: ComponentFixture<PackageDetailsVulnerabilitiesComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      declarations: [PackageDetailsVulnerabilitiesComponent, SeverityPipe],
      imports: [CommonModule],
      schemas: [NO_ERRORS_SCHEMA],
    }).compileComponents();
  });

  beforeEach(() => {
    fixture = TestBed.createComponent(PackageDetailsVulnerabilitiesComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('renders advisory links and severity for a vulnerable version', () => {
    const vulnerabilities: Vulnerability[] = [
      { advisoryUrl: 'https://advisories.example.test/CVE-1', severity: 3 },
      { advisoryUrl: 'https://advisories.example.test/CVE-2', severity: 2 },
    ];
    component.vulnerabilities = vulnerabilities;
    fixture.detectChanges();

    const warning = fixture.nativeElement.querySelector('[aria-label="Known package vulnerabilities"]') as HTMLElement;
    const links = Array.from(warning.querySelectorAll('a')) as HTMLAnchorElement[];
    expect(warning.textContent).toContain('Vulnerabilities detected (2)');
    expect(warning.textContent).toContain('critical severity');
    expect(warning.textContent).toContain('high severity');
    expect(links.map((link) => link.href)).toEqual(vulnerabilities.map((item) => item.advisoryUrl));
    expect(links.every((link) => link.rel === 'noopener noreferrer')).toBe(true);
  });

  it('renders deprecation reason and suggested alternate package', () => {
    const deprecation: PackageDeprecation = {
      message: 'Use the maintained package instead.',
      reasons: ['Legacy', 'CriticalBugs'],
      alternatePackage: { id: 'Widget.Next', range: '[2.0.0, )' },
    };
    component.deprecation = deprecation;
    fixture.detectChanges();

    const warning = fixture.nativeElement.querySelector('[aria-label="Package deprecation"]') as HTMLElement;
    expect(warning.textContent).toContain('This package version is deprecated');
    expect(warning.textContent).toContain(deprecation.message);
    expect(warning.textContent).toContain('Legacy, CriticalBugs');
    expect(warning.textContent).toContain('Widget.Next');
    expect(warning.textContent).toContain('[2.0.0, )');
  });

  it('does not render warnings when metadata is absent or the vulnerability list is empty', () => {
    component.vulnerabilities = [];
    component.deprecation = undefined;
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelectorAll('section[role="note"]').length).toBe(0);
  });
});
