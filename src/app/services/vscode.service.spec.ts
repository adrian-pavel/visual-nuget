import { TestBed } from '@angular/core/testing';

import { VscodeService } from './vscode.service';

describe('VscodeService', () => {
  let service: VscodeService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(VscodeService);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });
});
