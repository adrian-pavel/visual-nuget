import { TestBed, waitForAsync } from '@angular/core/testing';
import { AppComponent } from './app.component';
import { PackageManagerService } from './services/package-manager.service';

describe('AppComponent', () => {
  const packageManagerMock = {
    changeCurrentProject: jest.fn(),
    changeCurrentSources: jest.fn(),
  };

  beforeEach(
    waitForAsync(() => {
      TestBed.configureTestingModule({
        declarations: [AppComponent],
        providers: [{ provide: PackageManagerService, useValue: packageManagerMock }],
      }).compileComponents();
    })
  );

  it('should create the app', () => {
    const fixture = TestBed.createComponent(AppComponent);
    const app = fixture.debugElement.componentInstance;
    expect(app).toBeTruthy();
  });
});
