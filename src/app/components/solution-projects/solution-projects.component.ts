import { Component, OnInit, ChangeDetectionStrategy } from '@angular/core';
import { ProjectLoadFailure } from '../../../../src-common/models/project';
import { PackageManagerService } from '../../services/package-manager.service';
import { BaseComponent } from '../base-component';

@Component({
  selector: 'app-solution-projects',
  templateUrl: './solution-projects.component.html',
  styleUrls: ['./solution-projects.component.scss'],
  changeDetection: ChangeDetectionStrategy.Eager,
  standalone: false,
})
export class SolutionProjectsComponent extends BaseComponent implements OnInit {
  public unsupportedProjects: string[] = [];
  public loadFailures: ProjectLoadFailure[] = [];

  constructor(private readonly packageManager: PackageManagerService) {
    super();
  }

  public ngOnInit(): void {
    this.subscriptions.add(
      this.packageManager.currentSolution.subscribe((solution) => {
        this.unsupportedProjects = solution?.unsupportedProjects ?? [];
        this.loadFailures = solution?.loadFailures ?? [];
      })
    );
  }

  public get hasStatus(): boolean {
    return this.unsupportedProjects.length > 0 || this.loadFailures.length > 0;
  }
}
