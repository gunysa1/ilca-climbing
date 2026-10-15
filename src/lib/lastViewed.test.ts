import { describe, expect, it } from 'vitest';
import { lastViewedHref, parseLastViewed } from './lastViewed';

const v = { competition_id: 'c1', competition: 'Cup', competition_he: null, round_id: null, round_kind: null, category: null, category_he: null };

describe('lastViewed', () => {
  it('parses valid entries and rejects junk', () => {
    expect(parseLastViewed(JSON.stringify(v))).toEqual(v);
    expect(parseLastViewed('{"x":1}')).toBeNull();
    expect(parseLastViewed('nope')).toBeNull();
    expect(parseLastViewed(null)).toBeNull();
  });
  it('links to the round when there is one', () => {
    expect(lastViewedHref(v)).toBe('/competition/c1');
    expect(lastViewedHref({ ...v, round_id: 'r1' })).toBe('/round/r1');
  });
});
