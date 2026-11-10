import { describe, expect, it } from 'vitest';
import { ascentCellText, boulderCellText } from './printing';

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

describe('ascentCellText', () => {
  const boulder = { boulder_id: 'b', climber_id: 'c', attempts: 2, top_attempt: 2, zone_attempt: 1 };
  const route = { boulder_id: 'r', climber_id: 'c', hold: 36, plus: true, top: false, time_ms: 130_000 };
  it('a boulder', () => { expect(ascentCellText({ lead: false, status: null, showTime: false, boulder })).toBe('T2 Z1'); });
  it('a lead height, with the time only where it breaks ties', () => {
    expect(ascentCellText({ lead: true, status: null, showTime: false, route })).toBe('36+');
    expect(ascentCellText({ lead: true, status: null, showTime: true, route })).toBe('36+ · 2:10');
    expect(ascentCellText({ lead: true, status: null, showTime: true, route: { ...route, top: true } })).toBe('TOP · 2:10');
    expect(ascentCellText({ lead: true, status: null, showTime: true })).toBe('');
  });
  it('DNS is empty, DSQ keeps its results', () => {
    expect(ascentCellText({ lead: false, status: 'dns', showTime: false, boulder })).toBe('');
    expect(ascentCellText({ lead: true, status: 'dns', showTime: false, route })).toBe('');
    expect(ascentCellText({ lead: false, status: 'dsq', showTime: false, boulder })).toBe('T2 Z1');
  });
});
