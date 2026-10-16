import { Component, Input, ChangeDetectionStrategy } from '@angular/core';
import { PackageDependencyGroup } from 'src/app/models/package-meta';

@Component({
    selector: 'app-package-details-dependencies',
    templateUrl: './package-details-dependencies.component.html',
    styleUrls: ['./package-details-dependencies.component.scss'],
    changeDetection: ChangeDetectionStrategy.Eager,
    standalone: false
})
export class PackageDetailsDependenciesComponent {
  @Input()
  public dependencyGroups: PackageDependencyGroup[] | undefined;
}
