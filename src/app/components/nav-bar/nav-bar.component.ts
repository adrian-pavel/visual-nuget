import { Component, OnInit } from '@angular/core';
import { Category } from 'src/app/models/category';
import { PackageManagerService } from 'src/app/services/package-manager.service';

import { BaseComponent } from '../base-component';

@Component({
  selector: 'app-nav-bar',
  templateUrl: './nav-bar.component.html',
  styleUrls: ['./nav-bar.component.scss'],
})
export class NavBarComponent extends BaseComponent implements OnInit {
  public Category = Category;

  public currentCategory = Category.Browse;

  public currentProjectName: string | undefined;
  public currentProjectFsPath: string | undefined;

  constructor(private packageManager: PackageManagerService) {
    super();
  }

  ngOnInit(): void {
    this.listenForProjectNameChange();
    this.listenForCurrentCategoryChange();
  }

  private listenForCurrentCategoryChange(): void {
    this.subscriptions.add(
      this.packageManager.currentCategory.subscribe((category: Category) => {
        this.currentCategory = category;
      })
    );
  }

  private listenForProjectNameChange(): void {
    this.subscriptions.add(
      this.packageManager.currentProject.subscribe((project) => {
        this.currentProjectName = project?.name;
        this.currentProjectFsPath = project?.fsPath;
      })
    );
  }

  public categoryChange(category: Category): void {
    this.packageManager.changeCurrentCategory(category);
  }
}
