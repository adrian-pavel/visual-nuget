import { NO_ERRORS_SCHEMA } from '@angular/core';
import { ComponentFixture, TestBed, waitForAsync } from '@angular/core/testing';
import { AppComponent } from './app.component';
import { ExtensionMessage } from '../../src-common/models/extension-message';
import { PackageSource } from '../../src-common/models/package-source';
import { PackageManagerService } from './services/package-manager.service';
import { Project } from 'src-common/models/project';

describe('AppComponent', () => {
  let component: AppComponent;
  let fixture: ComponentFixture<AppComponent>;
  const packageManagerMock = {
    changeCurrentProject: jest.fn(),
    changeCurrentSources: jest.fn(),
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
});
