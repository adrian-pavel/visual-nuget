import { ComponentFixture, TestBed } from '@angular/core/testing';

import { PackageDetailsVulnerabilitiesComponent } from './package-details-vulnerabilities.component';

describe('PackageDetailsVulnerabilitiesComponent', () => {
  let component: PackageDetailsVulnerabilitiesComponent;
  let fixture: ComponentFixture<PackageDetailsVulnerabilitiesComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      declarations: [ PackageDetailsVulnerabilitiesComponent ]
    })
    .compileComponents();
  });

  beforeEach(() => {
    fixture = TestBed.createComponent(PackageDetailsVulnerabilitiesComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
