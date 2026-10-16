import { Pipe, PipeTransform } from '@angular/core';

@Pipe({
    name: 'severity',
    standalone: false
})
export class SeverityPipe implements PipeTransform {
  transform(value: number | string): string {
    switch (value) {
      case 0:
      case '0':
        return 'low severity';
      case 1:
      case '1':
        return 'moderate severity';
      case 2:
      case '2':
        return 'high severity';
      case 3:
      case '3':
        return 'critical severity';
      default:
        return 'unknown severity';
    }
  }
}
