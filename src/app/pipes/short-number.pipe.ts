import { Pipe, PipeTransform } from '@angular/core';

@Pipe({
  name: 'shortNumber',
})
export class ShortNumberPipe implements PipeTransform {
  transform(value: number | null, ..._args: unknown[]): unknown {
    if (value === null) {
      return null;
    }
    if (value === 0) {
      return '0';
    }
    var fractionSize = 1;
    var rounder = Math.pow(10, fractionSize);
    var key = '';
    var powers = [
      { key: 'Q', value: Math.pow(10, 15) },
      { key: 'T', value: Math.pow(10, 12) },
      { key: 'B', value: Math.pow(10, 9) },
      { key: 'M', value: Math.pow(10, 6) },
      { key: 'K', value: Math.pow(10, 3) },
    ];
    for (var i = 0; i < powers.length; i++) {
      var reduced = value / powers[i].value;
      reduced = Math.round(reduced * rounder) / rounder;
      if (reduced >= 1) {
        value = reduced;
        key = powers[i].key;
        break;
      }
    }
    return value + key;
  }
}
