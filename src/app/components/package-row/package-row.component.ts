import { Component, Input } from '@angular/core';
import { PackageRowModel } from 'src/app/models/package-row-model';
import { PackageManagerService } from 'src/app/services/package-manager.service';

@Component({
  selector: 'app-package-row',
  templateUrl: './package-row.component.html',
  styleUrls: ['./package-row.component.scss'],
})
export class PackageRowComponent {
  @Input()
  public isActive = false;

  @Input()
  public package: PackageRowModel | null = null;

  constructor(private packageManager: PackageManagerService) {}

  public select(): void {
    this.packageManager.changeCurrentSelectedPackage(this.package);
  }

  public install(event: MouseEvent): void {
    event.stopPropagation();
    this.packageManager.installPackage(this.package);
  }

  public uninstall(event: MouseEvent): void {
    event.stopPropagation();
    this.packageManager.uninstallPackage(this.package);
  }

  public update(event: MouseEvent): void {
    event.stopPropagation();
    this.packageManager.installPackage(this.package);
  }
}
