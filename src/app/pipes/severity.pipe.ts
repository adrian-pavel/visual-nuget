import { Pipe, PipeTransform } from '@angular/core';

@Pipe({
  name: 'severity',
})
export class SeverityPipe implements PipeTransform {
  transform(value: string): unknown {
    let description = '';
    switch (value) {
      case '0':
        description = 'low';
        break;
      case '1':
        description = 'moderate';
        break;
      case '2':
        description = 'high';
        break;
      case '3':
        description = 'critical';
        break;
    }

    return `${description} severity`;
  }
}
