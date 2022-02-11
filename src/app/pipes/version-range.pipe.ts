import { Pipe, PipeTransform } from '@angular/core';

@Pipe({
  name: 'versionRange',
})
export class VersionRangePipe implements PipeTransform {
  transform(value: string, ..._args: unknown[]): string {
    // [1.6.1, 2.0.3)
    // [1.6.1, )
    // ( ,1.6.1]
    const leftEnd = value[0];
    const rightEnd = value[value.length - 1];
    const remaining = value.substring(1, value.length - 1);

    const versions = remaining.split(',');

    const minVersion = versions[0].trim();
    const maxVersion = versions[1].trim();

    const leftSign = this.getComparisonSign(leftEnd);
    const rightSign = this.getComparisonSign(rightEnd);

    let result = '';

    if (minVersion !== '') {
      result += leftSign + minVersion;

      if (maxVersion !== '') {
        result += ' && ';
      }
    }

    if (maxVersion !== '') {
      result += rightSign + maxVersion;
    }

    return `(${result})`;
  }

  private getComparisonSign(intervalSign: string): string {
    switch (intervalSign) {
      case '[':
        return '>=';
      case '(':
        return '>';
      case ']':
        return '<=';
      case ')':
        return '<';
      default:
        return '';
    }
  }
}
