import { SeverityPipe } from './severity.pipe';

describe('SeverityPipe', () => {
  test('create an instance', () => {
    const pipe = new SeverityPipe();
    expect(pipe).toBeTruthy();
  });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  test.each<any>([
    ['0', 'low severity'],
    ['1', 'moderate severity'],
    ['2', 'high severity'],
    ['3', 'critical severity'],
  ])('should return correct result', (severity: string, expectedDescription: string) => {
    const pipe = new SeverityPipe();

    const result = pipe.transform(severity);

    expect(result).toBe(expectedDescription);
  });
});
