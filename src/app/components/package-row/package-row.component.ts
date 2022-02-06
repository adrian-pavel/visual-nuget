import { Component, Input, OnInit } from '@angular/core';
import { PackageDetailsModel } from 'src/app/models/package-details';
import { PackageManagerService } from 'src/app/services/package-manager.service';

@Component({
  selector: 'app-package-row',
  templateUrl: './package-row.component.html',
  styleUrls: ['./package-row.component.scss'],
})
export class PackageRowComponent implements OnInit {
  @Input()
  public isActive: boolean = false;

  @Input()
  public package: PackageDetailsModel | null = null;

  constructor(private packageManager: PackageManagerService) {}

  ngOnInit(): void {}

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
