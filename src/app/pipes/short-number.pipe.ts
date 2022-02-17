import { Pipe, PipeTransform } from '@angular/core';

@Pipe({
  name: 'shortNumber',
})
export class ShortNumberPipe implements PipeTransform {
  transform(value: number | null): unknown {
    if (value === null) {
      return null;
    }
    if (value === 0) {
      return '0';
    }
    const fractionSize = 1;
    const rounder = Math.pow(10, fractionSize);
    let key = '';
    const powers = [
      { key: 'Q', value: Math.pow(10, 15) },
      { key: 'T', value: Math.pow(10, 12) },
      { key: 'B', value: Math.pow(10, 9) },
      { key: 'M', value: Math.pow(10, 6) },
      { key: 'K', value: Math.pow(10, 3) },
    ];
    for (const power of powers) {
      let reduced = value / power.value;
      reduced = Math.round(reduced * rounder) / rounder;
      if (reduced >= 1) {
        value = reduced;
        key = power.key;
        break;
      }
    }
    return value + key;
  }
}
