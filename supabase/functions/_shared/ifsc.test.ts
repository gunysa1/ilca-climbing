import { describe, expect, it } from 'vitest';
import { currentSeason, eventType, ilcaSeason, localDate, nameScore, pickMatch, reachedOf, skeleton, type Candidate } from './ifsc';

describe('eventType', () => {
  it.each([
    ['IFSC Climbing World Cup Innsbruck 2025', 'world_cup'],
    ['World Climbing Series Bern 2026', 'world_cup'],
    ['IFSC Climbing World Championships Seoul 2025', 'world_championship'],
    ['World Climbing Europe Championship Laval 2026', 'european_championship'],
    ['World Climbing Europe Series Kaunas 2026', 'european_cup'],
    ['IFSC Europe - Youth Championship - Helsinki (FIN) 2023', 'european_youth_championship'],
    ['World Climbing Europe Youth Series Graz 2026', 'european_youth_cup'],
    ['World Climbing Youth Championship Arco 2026', 'world_youth_championship'],
    ['IFSC Asian Cup', null],
  ])('%s', (name, type) => expect(eventType(name)).toBe(type));
});

describe('seasons', () => {
  it('ilcaSeason is the calendar year', () => {
    expect(ilcaSeason('2026-05-01')).toBe('2026-27');
    expect(ilcaSeason('2026-12-31')).toBe('2026-27');
  });
  it('currentSeason runs September to August', () => {
    expect(currentSeason('2026-10-17')).toBe('2026-27');
    expect(currentSeason('2027-03-01')).toBe('2026-27');
    expect(currentSeason('2027-08-31')).toBe('2026-27');
    expect(currentSeason('2027-09-01')).toBe('2027-28');
  });
  it('localDate is the date in Israel, not UTC', () => {
    expect(localDate(new Date('2026-12-31T22:30:00Z'))).toBe('2027-01-01'); // 00:30 in Israel (winter, UTC+2)
    expect(localDate(new Date('2026-06-30T20:59:00Z'))).toBe('2026-06-30'); // 23:59 in Israel (summer, UTC+3)
    expect(localDate(new Date('2026-06-30T21:00:00Z'))).toBe('2026-07-01');
  });
});

describe('reachedOf', () => {
  it('uses the last round with a score or rank', () => {
    expect(reachedOf([{ round_name: 'Qualification', score: '3t' }, { round_name: 'Semi-final', score: '1t' }])).toBe('semifinal');
    expect(reachedOf([{ round_name: 'Qualification', score: '3t' }, { round_name: 'Semi-final', score: '1t' }, { round_name: 'Final', rank: 3 }])).toBe('final');
    expect(reachedOf([{ round_name: 'Qualification', score: '3t' }, { round_name: 'Final', score: null }])).toBe('qualification');
    expect(reachedOf([])).toBe('qualification');
  });
});

describe('names', () => {
  it('skeleton unifies Hebrew and Latin', () => {
    expect(skeleton('Yonatan')).toBe(skeleton('יונתן'));
  });
  it('nameScore is 0..1 with 2 decimals', () => {
    expect(nameScore('Yonatan', 'Katz', 'יונתן כץ', null)).toBeGreaterThanOrEqual(0.5);
    expect(nameScore('Yonatan', 'Katz', null, 'Yonatan Katz')).toBe(1);
    expect(nameScore('Yonatan', 'Katz', null, null)).toBe(0);
  });
});

const prof = (id: string, he: string, over: Partial<Candidate> = {}): Candidate =>
  ({ id, full_name: null, full_name_he: he, gender: 'male', birth_date: '2008-01-02', ...over });

describe('pickMatch', () => {
  const katz = { firstname: 'Yonatan', lastname: 'KATZ', gender: 'male', birthday: '2008-01-02' };
  it('single birthday candidate with a similar name matches', () => {
    expect(pickMatch(katz, [prof('a', 'יונתן כץ'), prof('b', 'דנה לוי', { birth_date: '2009-05-05' })]))
      .toMatchObject({ status: 'match', profileId: 'a' });
  });
  it('twins sharing a birthday are told apart by name when the gap is wide enough', () => {
    const alma = { firstname: 'Alma', lastname: 'SAPIR HALEVI', gender: 'female', birthday: '2010-03-04' };
    const t = { gender: 'female', birth_date: '2010-03-04' };
    expect(pickMatch(alma, [prof('mia', 'מיה ספיר הלוי', t), prof('alma', 'עלמה ספיר הלוי', { ...t, full_name: 'Alma Sapir Halevi' })]))
      .toMatchObject({ status: 'match', profileId: 'alma' });
  });
  it('twins with only Hebrew names stay pending (0.92 vs 0.83 is inside the 0.15 margin)', () => {
    const alma = { firstname: 'Alma', lastname: 'SAPIR HALEVI', gender: 'female', birthday: '2010-03-04' };
    const t = { gender: 'female', birth_date: '2010-03-04' };
    expect(pickMatch(alma, [prof('mia', 'מיה ספיר הלוי', t), prof('alma', 'עלמה ספיר הלוי', t)]))
      .toMatchObject({ status: 'pending', suggestion: 'alma' });
  });
  it('no birthday hit is pending without a suggestion', () => {
    expect(pickMatch(katz, [prof('a', 'יונתן כץ', { birth_date: '2007-01-01' })])).toEqual({ status: 'pending', suggestion: null, score: null });
    expect(pickMatch({ ...katz, birthday: null }, [prof('a', 'יונתן כץ')])).toEqual({ status: 'pending', suggestion: null, score: null });
  });
  it('gender mismatch is excluded, null profile gender is compatible', () => {
    expect(pickMatch(katz, [prof('a', 'יונתן כץ', { gender: 'female' })])).toMatchObject({ status: 'pending', suggestion: null });
    expect(pickMatch(katz, [prof('a', 'יונתן כץ', { gender: null })])).toMatchObject({ status: 'match', profileId: 'a' });
  });
  it('birthday hit with a different name is pending with a suggestion', () => {
    expect(pickMatch(katz, [prof('a', 'דנה לוי')])).toMatchObject({ status: 'pending', suggestion: 'a' });
  });
});
