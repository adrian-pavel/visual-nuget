import { Component, Input, ChangeDetectionStrategy } from '@angular/core';
import { PackageDeprecation, Vulnerability } from 'src/app/models/package-meta';

@Component({
    selector: 'app-package-details-vulnerabilities',
    templateUrl: './package-details-vulnerabilities.component.html',
    styleUrls: ['./package-details-vulnerabilities.component.scss'],
    changeDetection: ChangeDetectionStrategy.Eager,
    standalone: false
})
export class PackageDetailsVulnerabilitiesComponent {
  @Input()
  public vulnerabilities: Vulnerability[] | undefined;

  @Input()
  public deprecation: PackageDeprecation | undefined;
}
