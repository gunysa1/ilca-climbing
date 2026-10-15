import { describe, expect, it } from 'vitest';
import { disciplinesOf } from './discipline';

describe('disciplinesOf', () => {
  it('maps boulder formats to boulder and lead to lead', () => {
    expect([...disciplinesOf(['ifsc2025', 'classic'])]).toEqual(['boulder']);
    expect([...disciplinesOf(['lead'])]).toEqual(['lead']);
    expect([...disciplinesOf(['ifsc2025', 'lead'])].sort()).toEqual(['boulder', 'lead']);
    expect(disciplinesOf([]).size).toBe(0);
  });
});
