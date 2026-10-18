import { describe, expect, it } from 'vitest';
import { climbsRoutes, competitionDisciplines, disciplinesOf, roundFormatsFor } from './discipline';

describe('disciplinesOf', () => {
  it('maps boulder formats to boulder and lead to lead', () => {
    expect([...disciplinesOf(['ifsc2025', 'classic'])]).toEqual(['boulder']);
    expect([...disciplinesOf(['lead'])]).toEqual(['lead']);
    expect([...disciplinesOf(['ifsc2025', 'lead'])].sort()).toEqual(['boulder', 'lead']);
    expect(disciplinesOf([]).size).toBe(0);
  });
});

describe('competitionDisciplines', () => {
  it('uses the chosen discipline, else the rounds', () => {
    expect([...competitionDisciplines('lead', [])]).toEqual(['lead']);
    expect([...competitionDisciplines('speed', ['ifsc2025'])]).toEqual(['speed']);
    expect([...competitionDisciplines(null, ['ifsc2025', 'lead'])].sort()).toEqual(['boulder', 'lead']);
    expect(competitionDisciplines(undefined, []).size).toBe(0);
  });
});

describe('climbsRoutes', () => {
  it("a round's scoring decides; the competition fills in before rounds exist", () => {
    expect(climbsRoutes('boulder', 'lead')).toBe(true);
    expect(climbsRoutes('lead', 'ifsc2025')).toBe(false);
    expect(climbsRoutes('lead')).toBe(true);
    expect(climbsRoutes('boulder')).toBe(false);
    expect(climbsRoutes(null)).toBe(false);
    expect(climbsRoutes('speed', 'ifsc2025')).toBe(true);
  });
});

describe('roundFormatsFor', () => {
  it('lead offers lead only, boulder the boulder formats (IFSC 2025 first), speed nothing yet', () => {
    expect(roundFormatsFor('lead')).toEqual(['lead']);
    expect(roundFormatsFor('boulder')).toEqual(['ifsc2025', 'classic']);
    expect(roundFormatsFor('speed')).toEqual([]);
    expect(roundFormatsFor(null)).toEqual(['ifsc2025', 'classic', 'lead']);
  });
});
