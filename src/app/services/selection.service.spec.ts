import { TestBed } from '@angular/core/testing';

import { SelectionService } from './selection.service';

describe('SelectionService', () => {
  let service: SelectionService<number>;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [{ provide: SelectionService, useClass: SelectionService }],
    });
    service = TestBed.inject(SelectionService);
  });

  test('should be created', () => {
    expect(service).toBeTruthy();
  });

  test('selecting adds to the selected list', () => {
    service.select(1);
    expect(service.selected).toEqual([1]);
  });

  test('selecting same number multiple times, selected only once', () => {
    service.select(1);
    service.select(1);
    service.select(1);
    expect(service.selected).toEqual([1]);
  });

  test('selecting multiple', () => {
    service.selectAll([1, 3, 2]);
    expect(service.selected).toEqual([1, 3, 2]);
  });

  test('deselecting removes from selected list', () => {
    service.select(1);
    expect(service.selected).toEqual([1]);

    service.deselect(1);

    expect(service.isEmpty).toEqual(true);
  });

  test('clear', () => {
    service.selectAll([1, 3, 2]);
    expect(service.selected).toEqual([1, 3, 2]);

    service.clear();
    expect(service.selected).toEqual([]);
  });

  test('are all selected true', () => {
    service.selectAll([1, 3, 2]);
    expect(service.selected).toEqual([1, 3, 2]);

    const result = service.areAllSelected([2, 1, 3]);
    expect(result).toEqual(true);
  });

  test('are all selected false', () => {
    service.selectAll([1, 3, 2]);
    expect(service.selected).toEqual([1, 3, 2]);

    const result = service.areAllSelected([2, 1, 3, 4]);
    expect(result).toEqual(false);
  });

  test('are all selected false on empty selection', () => {
    const result = service.areAllSelected([2]);
    expect(result).toEqual(false);
  });

  test('is selected true', () => {
    service.select(1);
    expect(service.selected).toEqual([1]);

    const result = service.isSelected(1);
    expect(result).toEqual(true);
  });

  test('is selected false', () => {
    service.select(1);
    expect(service.selected).toEqual([1]);

    const result = service.isSelected(2);
    expect(result).toEqual(false);
  });
});
