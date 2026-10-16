import { TestBed } from '@angular/core/testing';
import { rcompare, coerce, SemVer } from 'semver';

import { VersionService } from './version.service';

jest.mock('semver', () => ({
  rcompare: jest.fn(),
  coerce: jest.fn(),
}));

describe('VersionService', () => {
  let service: VersionService;
  const mockRcompare = rcompare as jest.MockedFunction<typeof rcompare>;
  const mockCoerce = coerce as jest.MockedFunction<typeof coerce>;
  const realSemver = jest.requireActual<typeof import('semver')>('semver');

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(VersionService);
    jest.clearAllMocks();
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  // Test cases for valid semver comparison
  test.each([
    { v1: '1.2.0', v2: '1.1.0', expected: -1 },
    { v1: '1.1.0', v2: '1.1.0', expected: 0 },
    { v1: '1.0.0', v2: '1.1.0', expected: 1 },
  ])('should directly compare valid semver versions', ({ v1, v2, expected }) => {
    mockRcompare.mockReturnValue(<-1 | 0 | 1>expected);

    const result = service.compareSemVers(v1, v2);

    expect(mockRcompare).toHaveBeenCalledWith(v1, v2, { loose: true });
    expect(result).toBe(expected);
  });

  // Test cases for non-semver versions with revision
  test.each([
    { v1: '1.0.0.23', v2: '1.0.0.5', expected: -1 },
    { v1: '1.0.0.5', v2: '1.0.0.23', expected: 1 },
    { v1: '1.0.0.23', v2: '1.0.0.23', expected: 0 },
    { v1: '1.0.0.23', v2: '1.0.0', expected: -1 },
    { v1: '1.0.0', v2: '1.0.0.2456', expected: 1 },
  ])('should compare non-semver versions with revision', ({ v1, v2, expected }) => {
    mockRcompare
      .mockImplementationOnce(() => {
        throw new Error(); // First throw error to go to coercing
      })
      .mockReturnValue(0); // Then assume semver parts are equal to compare revision
    mockCoerce.mockImplementation(() => <SemVer>(<unknown>'1.0.0'));

    const result = service.compareSemVers(v1, v2);

    expect(mockCoerce).toHaveBeenCalledWith(v1);
    expect(mockCoerce).toHaveBeenCalledWith(v2);
    expect(result).toBe(expected);
  });

  test.each([
    { v1: 'v1.0.1', v2: 'v1.0.0', expected: -1 },
    { v1: 'v1.0.0', v2: 'v1.0.1', expected: 1 },
    { v1: 'v1.0.0', v2: 'v1.0.0', expected: 0 },
  ])('should handle non-semver versions by coercing them and comparing', ({ v1, v2, expected }) => {
    mockRcompare
      .mockImplementationOnce(() => {
        throw new Error(); // First throw error to go to coercing
      })
      .mockReturnValue(<-1 | 0 | 1>expected);

    mockCoerce.mockImplementation((version): SemVer | null => {
      if (version === 'v1.0.0') return <SemVer>(<unknown>'1.0.0');
      if (version === 'v1.0.1') return <SemVer>(<unknown>'1.0.1');
      return null;
    });

    const result = service.compareSemVers(v1, v2);

    expect(mockCoerce).toHaveBeenCalledWith(v1);
    expect(mockCoerce).toHaveBeenCalledWith(v2);
    expect(result).toBe(expected);
  });

  it('should return 0 when semver cannot coerce the versions', () => {
    mockRcompare.mockImplementationOnce(() => {
      throw new Error(); // First throw error to go to coercing
    });
    mockCoerce.mockReturnValue(null);

    const result = service.compareSemVers('invalid.version', 'another.invalid.version');

    expect(mockCoerce).toHaveBeenCalledWith('invalid.version');
    expect(mockCoerce).toHaveBeenCalledWith('another.invalid.version');
    expect(result).toBe(0);
  });

  test.each<[string, string, boolean]>([
    ['7.0.0', '[7.0.0]', true],
    ['7.0.1', '[7.0.0]', false],
    ['8.0.0', '7.0.0', true],
    ['6.9.9', '7.0.0', false],
    ['7.0.0', '[7.0.0, 8.0.0)', true],
    ['7.9.9', '[7.0.0, 8.0.0)', true],
    ['8.0.0', '[7.0.0, 8.0.0)', false],
    ['8.0.0', '(, 8.0.0]', true],
    ['8.0.1', '(, 8.0.0]', false],
    ['7.9.0', '7.*', true],
    ['8.0.0', '7.*', false],
    ['7.9.0-beta.1', '7.*', false],
    ['7.9.0-beta.1', '7.*-*', true],
  ])('should evaluate NuGet version range %s against %s', (version, range, expected) => {
    mockRcompare.mockImplementation(realSemver.rcompare);
    mockCoerce.mockImplementation(realSemver.coerce);

    expect(service.satisfiesVersionRange(version, range)).toBe(expected);
  });
});
