import { Component, OnInit } from '@angular/core';
import { Category } from 'src/app/models/category';
import { PackageManagerService } from 'src/app/services/package-manager.service';

@Component({
  selector: 'app-nav-bar',
  templateUrl: './nav-bar.component.html',
  styleUrls: ['./nav-bar.component.scss'],
})
export class NavBarComponent implements OnInit {
  public Category = Category;

  public currentCategory = Category.Browse;

  public currentProjectName: string | undefined;

  constructor(private packageManager: PackageManagerService) {}

  ngOnInit(): void {
    this.listenForProjectNameChange();
    this.listenForCurrentCategoryChange();
  }

  private listenForCurrentCategoryChange(): void {
    this.packageManager.currentCategory.subscribe((category: Category) => {
      this.currentCategory = category;
    });
  }

  private listenForProjectNameChange(): void {
    this.packageManager.currentProject.subscribe((project) => {
      this.currentProjectName = project?.name;
    });
  }

  public categoryChange(category: Category): void {
    this.packageManager.changeCurrentCategory(category);
  }
}
