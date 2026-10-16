import { Component, OnInit, ChangeDetectionStrategy } from '@angular/core';
import { Category } from 'src/app/models/category';
import { PackageManagerService, UpdateCountState } from 'src/app/services/package-manager.service';

import { BaseComponent } from '../base-component';

@Component({
    selector: 'app-nav-bar',
    templateUrl: './nav-bar.component.html',
    styleUrls: ['./nav-bar.component.scss'],
    changeDetection: ChangeDetectionStrategy.Eager,
    standalone: false
})
export class NavBarComponent extends BaseComponent implements OnInit {
  public Category = Category;

  public currentCategory = Category.Browse;

  public currentProjectName: string | undefined;
  public currentProjectFsPath: string | undefined;
  public isSolution = false;
  public consolidationCount = 0;
  public updateCountState: UpdateCountState = { count: null, loading: false };

  constructor(private packageManager: PackageManagerService) {
    super();
  }

  ngOnInit(): void {
    this.listenForProjectNameChange();
    this.listenForCurrentCategoryChange();
    this.subscriptions.add(
      this.packageManager.availableUpdateCount.subscribe((state) => {
        this.updateCountState = state;
      })
    );
  }

  public categoryChange(category: Category): void {
    this.packageManager.changeCurrentCategory(category);
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
        this.isSolution = false;
      })
    );
    this.subscriptions.add(
      this.packageManager.currentSolution.subscribe((solution) => {
        this.consolidationCount = this.packageManager.consolidationCount;
        if (solution) {
          this.currentProjectName = solution.name;
          this.currentProjectFsPath = solution.fsPath;
          this.isSolution = true;
        } else {
          this.isSolution = false;
        }
      })
    );
  }
}
