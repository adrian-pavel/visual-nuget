import { Component, Input, OnInit } from '@angular/core';
import { PackageDependencyGroup } from 'src/app/models/package-meta';

@Component({
  selector: 'app-package-details-dependencies',
  templateUrl: './package-details-dependencies.component.html',
  styleUrls: ['./package-details-dependencies.component.scss'],
})
export class PackageDetailsDependenciesComponent {
  @Input()
  public dependencyGroups: PackageDependencyGroup[] | undefined;

  constructor() {}
}
