import { SeverityPipe } from './severity.pipe';

describe('SeverityPipe', () => {
  test.each([
    [0, 'low severity'],
    [1, 'moderate severity'],
    [2, 'high severity'],
    [3, 'critical severity'],
    ['unexpected', 'unknown severity'],
  ])('maps severity %s to %s', (severity: number | string, expectedDescription: string) => {
    const pipe = new SeverityPipe();

    const result = pipe.transform(severity);

    expect(result).toBe(expectedDescription);
  });
});
