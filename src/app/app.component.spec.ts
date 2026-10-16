import { NO_ERRORS_SCHEMA } from '@angular/core';
import { ComponentFixture, TestBed, waitForAsync } from '@angular/core/testing';
import { BehaviorSubject } from 'rxjs';
import { AppComponent } from './app.component';
import { ExtensionMessage } from '../../src-common/models/extension-message';
import { PackageSource } from '../../src-common/models/package-source';
import { PackageManagerService } from './services/package-manager.service';
import { Project } from 'src-common/models/project';

describe('AppComponent', () => {
  let component: AppComponent;
  let fixture: ComponentFixture<AppComponent>;
  const contextLoading = new BehaviorSubject<{ message: string; completed?: number; total?: number; error?: boolean } | null>(null);
  const packageQueryLoading = new BehaviorSubject(false);
  const packageManagerMock = {
    changeCurrentProject: jest.fn(),
    changeCurrentSolution: jest.fn(),
    changeCurrentSources: jest.fn(),
    setContextLoading: jest.fn(),
    setContextLoadError: jest.fn(),
    contextLoading,
    packageQueryLoading,
  };

  beforeEach(
    waitForAsync(() => {
      TestBed.configureTestingModule({
        declarations: [AppComponent],
        providers: [{ provide: PackageManagerService, useValue: packageManagerMock }],
        schemas: [NO_ERRORS_SCHEMA],
      }).compileComponents();
    })
  );

  beforeEach(() => {
    contextLoading.next(null);
    packageQueryLoading.next(false);
    fixture = TestBed.createComponent(AppComponent);
    component = fixture.debugElement.componentInstance;
    fixture.detectChanges();
  });

  test('should create the app', () => {
    expect(component).toBeTruthy();
  });

  test('should call change current project', () => {
    const event = new MessageEvent<ExtensionMessage>('message', {
      data: {
        type: 'project',
        data: {
          name: 'TestProject',
          fsPath: 'test/path',
          packages: [],
        } as Project,
      },
    });

    window.dispatchEvent(event);

    expect(packageManagerMock.changeCurrentProject.mock.calls[0][0]).toEqual(event.data.data);
  });

  test('should call change current sources', () => {
    const event = new MessageEvent<ExtensionMessage>('message', {
      data: {
        type: 'sources',
        data: [
          {
            name: 'TestSource',
            url: 'www.test.com',
          },
        ] as PackageSource[],
      },
    });

    window.dispatchEvent(event);

    expect(packageManagerMock.changeCurrentSources.mock.calls[0][0]).toEqual(event.data.data);
  });

  test('should forward context loading progress', () => {
    const event = new MessageEvent<ExtensionMessage>('message', {
      data: {
        type: 'context-loading',
        data: { message: 'Loading solution projects (2 of 8)...', completed: 2, total: 8 },
      },
    });

    window.dispatchEvent(event);

    expect(packageManagerMock.setContextLoading).toHaveBeenCalledWith('Loading solution projects (2 of 8)...', 2, 8);
  });

  test('centers solution loading progress in an overlay', () => {
    contextLoading.next({ message: 'Loading solution projects (2 of 8)...', completed: 2, total: 8 });
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('.loading-overlay')?.textContent).toContain('Loading solution projects (2 of 8)');
    expect(fixture.nativeElement.querySelector('.loading-overlay progress')?.value).toBe(2);
    expect(fixture.nativeElement.querySelector('.layout .loading-overlay')).not.toBeNull();
  });

  test('blocks interaction during context loading but leaves package searches interruptible', () => {
    contextLoading.next({ message: 'Loading installed package information...' });
    fixture.detectChanges();

    const header = fixture.nativeElement.querySelector('.header') as HTMLElement;
    const mainSection = fixture.nativeElement.querySelector('.main-section') as HTMLElement;
    const overlay = fixture.nativeElement.querySelector('.loading-overlay') as HTMLElement;
    expect(header.hasAttribute('inert')).toBe(true);
    expect(mainSection.hasAttribute('inert')).toBe(true);
    expect(overlay.classList.contains('loading-overlay--blocking')).toBe(true);

    contextLoading.next(null);
    packageQueryLoading.next(true);
    fixture.detectChanges();

    expect(header.hasAttribute('inert')).toBe(false);
    expect(mainSection.hasAttribute('inert')).toBe(false);
    expect(overlay.classList.contains('loading-overlay--blocking')).toBe(false);
  });
});
