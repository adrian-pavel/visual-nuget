import { CommonModule } from '@angular/common';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { BehaviorSubject } from 'rxjs';

import { Project, Solution } from '../../../../src-common/models/project';
import { Category } from '../../models/category';
import { UpdateCountState } from '../../services/package-manager.service';
import { PackageManagerService } from '../../services/package-manager.service';
import { NavBarComponent } from './nav-bar.component';

describe('NavBarComponent', () => {
  let fixture: ComponentFixture<NavBarComponent>;
  let packageManagerMock: {
    currentProject: BehaviorSubject<Project | null>;
    currentSolution: BehaviorSubject<Solution | null>;
    currentCategory: BehaviorSubject<Category>;
    availableUpdateCount: BehaviorSubject<UpdateCountState>;
    consolidationCount: number;
    changeCurrentCategory: jest.Mock;
  };

  beforeEach(async () => {
    const currentCategory = new BehaviorSubject<Category>(Category.Browse);
    packageManagerMock = {
      currentProject: new BehaviorSubject<Project | null>(null),
      currentSolution: new BehaviorSubject<Solution | null>(null),
      currentCategory,
      availableUpdateCount: new BehaviorSubject<UpdateCountState>({ count: null, loading: false }),
      consolidationCount: 0,
      changeCurrentCategory: jest.fn((category: Category) => currentCategory.next(category)),
    };

    await TestBed.configureTestingModule({
      imports: [CommonModule],
      declarations: [NavBarComponent],
      providers: [{ provide: PackageManagerService, useValue: packageManagerMock }],
    }).compileComponents();

    fixture = TestBed.createComponent(NavBarComponent);
    fixture.detectChanges();
  });

  test('shows a counted Consolidate tab only for a solution with eligible packages', () => {
    expect(findConsolidateButton()).toBeNull();

    packageManagerMock.consolidationCount = 2;
    packageManagerMock.currentSolution.next({
      name: 'Sample.sln',
      fsPath: 'Sample.sln',
      projects: [],
      unsupportedProjects: [],
      loadFailures: [],
    });
    fixture.detectChanges();

    const button = findConsolidateButton();
    expect(button).not.toBeNull();
    expect(button?.querySelector('.category-count')?.textContent?.trim()).toBe('2');
    button?.click();
    expect(packageManagerMock.changeCurrentCategory).toHaveBeenCalledWith(Category.Consolidate);

    packageManagerMock.consolidationCount = 0;
    packageManagerMock.currentSolution.next({
      name: 'Sample.sln',
      fsPath: 'Sample.sln',
      projects: [],
      unsupportedProjects: [],
      loadFailures: [],
    });
    fixture.detectChanges();
    expect(findConsolidateButton()).toBeNull();
  });

  test('keeps Consolidate hidden in project mode', () => {
    packageManagerMock.consolidationCount = 1;
    packageManagerMock.currentProject.next({ name: 'App.csproj', fsPath: 'App.csproj', packages: [] });
    fixture.detectChanges();

    expect(findConsolidateButton()).toBeNull();
  });

  function findConsolidateButton(): HTMLButtonElement | null {
    const buttons = Array.from(fixture.nativeElement.querySelectorAll('button.category-button')) as HTMLButtonElement[];
    return buttons.find((button) => button.textContent?.includes('Consolidate')) ?? null;
  }
});
