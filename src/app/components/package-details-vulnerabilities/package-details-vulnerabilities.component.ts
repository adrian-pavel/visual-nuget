import { Component, Input } from '@angular/core';
import { Vulnerability } from 'src/app/models/package-meta';

@Component({
  selector: 'app-package-details-vulnerabilities',
  templateUrl: './package-details-vulnerabilities.component.html',
  styleUrls: ['./package-details-vulnerabilities.component.scss'],
})
export class PackageDetailsVulnerabilitiesComponent {
  @Input()
  public vulnerabilities: Vulnerability[] | undefined;
}
