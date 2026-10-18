import { describe, expect, it } from 'vitest';
import { boulderCellText } from './printing';

describe('boulderCellText', () => {
  it('shows top and zone attempts', () => {
    expect(boulderCellText({ attempts: 3, top_attempt: 2, zone_attempt: 1 })).toBe('T2 Z1');
  });
  it('a top without a recorded zone counts the zone on the top attempt', () => {
    expect(boulderCellText({ attempts: 1, top_attempt: 1, zone_attempt: null })).toBe('T1 Z1');
  });
  it('zone only', () => {
    expect(boulderCellText({ attempts: 5, top_attempt: null, zone_attempt: 3 })).toBe('Z3');
  });
  it('tried without a zone, and not tried', () => {
    expect(boulderCellText({ attempts: 4, top_attempt: null, zone_attempt: null })).toBe('–');
    expect(boulderCellText({ attempts: 0, top_attempt: null, zone_attempt: null })).toBe('');
    expect(boulderCellText(undefined)).toBe('');
  });
});
