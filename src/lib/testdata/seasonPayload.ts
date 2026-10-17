// A season_rankings() payload for tests (as the database returns it: numerics may come as strings), with
// something for every part of a table: league events with ties, the (youth) championship, international events
// with and without an IFSC link, a manual ILCA row, the youth bonus, world ranking positions, an adjustment, a
// climber too young for the seniors and one without a profile.
type Row = Record<string, unknown>;

export function seasonPayload(season: string) {
  const y = Number(season.slice(0, 4));
  const rounds: Row[] = [];
  const add = (competition_id: string, series: string, discipline: string, category: string, gender: string, starts_on: string,
    round: string, ranks: Record<string, number | null>) => {
    for (const [climber_id, rank] of Object.entries(ranks)) {
      rounds.push({ competition_id, competition: `Event ${competition_id}`, starts_on, series, discipline,
        category_id: `${competition_id}-${category}`, category, gender, round, climber_id, rank });
    }
  };
  // three league events (women's boulder: a tie, a final; men's lead), a U17 league event, the championships
  add('l1', 'premier_league', 'boulder', 'נשים', 'female', `${y}-10-10`, 'qualification', { w1: 1, w2: 2, w3: 2, w4: 4, w5: 5, wy: 6 });
  add('l1', 'premier_league', 'boulder', 'נשים', 'female', `${y}-10-10`, 'final', { w2: 1, w1: 2, w3: 3 });
  add('l2', 'premier_league', 'boulder', 'נשים', 'female', `${y}-12-05`, 'qualification', { w3: 1, w1: 2, w5: 3, wy: 4, wn: 5 });
  add('l2', 'premier_league', 'lead', 'גברים', 'male', `${y}-12-05`, 'final', { m1: 1, m2: 2, m3: 2, my: 4 });
  add('l3', 'premier_league', 'lead', 'גברים', 'male', `${y + 1}-02-01`, 'final', { m2: 1, m1: 2, my: 3, m3: null });
  add('u1', 'premier_league_u17', 'boulder', 'U17 בנות', 'female', `${y}-11-11`, 'final', { wy: 1, g2: 2 });
  add('ch', 'israeli_championship', 'boulder', 'נשים', 'female', `${y + 1}-03-01`, 'final', { w1: 1, w3: 2, w2: 3, wy: 4 });
  add('yc', 'youth_championship', 'boulder', 'U17 בנות', 'female', `${y + 1}-04-01`, 'final', { g2: 1, wy: 2 });
  return {
    rounds,
    age_classes: [{ climber_id: 'g2', age_class: 'U17' }, { climber_id: 'wy', age_class: 'U17' }, { climber_id: 'w5', age_class: 'U21' }],
    too_young: ['wy', 'g2'],
    intl: [
      { id: 'i1', climber_id: 'w1', season, discipline: 'boulder', event_type: 'world_cup', event_name: 'WC Bern', starts_on: `${y + 1}-06-20`,
        place: 5, field_size: 57, reached: 'final', points: null, for_class: null, ifsc_event_id: 1401 },
      { id: 'i2', climber_id: 'w4', season, discipline: 'boulder', event_type: 'european_cup', event_name: 'EC Graz', starts_on: `${y + 1}-05-01`,
        place: 2, field_size: 40, reached: 'final', points: null, for_class: null, ifsc_event_id: null },
      { id: 'i3', climber_id: 'wy', season, discipline: 'boulder', event_type: 'european_youth_championship', event_name: 'EYCH',
        starts_on: `${y + 1}-07-10`, place: 3, field_size: 60, reached: 'final', points: null, for_class: null, ifsc_event_id: 1500 },
      { id: 'i4', climber_id: 'm1', season, discipline: 'lead', event_type: 'manual', event_name: 'ILCA published', starts_on: `${y + 1}-07-01`,
        place: null, field_size: null, reached: 'final', points: '42.50', for_class: 'senior', ifsc_event_id: null },
    ],
    adjustments: [{ id: 'a1', climber_id: 'w2', season, discipline: 'boulder', rank_class: null, points: '-10', note: 'late' }],
    world: [
      { climber_id: 'w1', discipline: 'boulder', position: 12, as_of: `${y}-10-01` },
      { climber_id: 'w4', discipline: 'boulder', position: 35, as_of: `${y}-10-01` },
      { climber_id: 'm2', discipline: 'lead', position: 7, as_of: `${y}-10-01` },
    ],
    profiles: [
      { id: 'w1', full_name: 'Noa Levi', full_name_he: 'נועה לוי', club: 'Club A', country: 'ISR', gender: 'female' },
      { id: 'w2', full_name: 'Tamar Cohen', full_name_he: 'תמר כהן', club: null, country: 'ISR', gender: 'female' },
      { id: 'w3', full_name: 'Maya Bar', full_name_he: null, club: 'Club B', country: 'ISR', gender: 'female' },
      { id: 'w4', full_name: 'Dana Gal', full_name_he: 'דנה גל', club: 'Club A', country: 'ISR', gender: 'female' },
      { id: 'w5', full_name: 'Lia Tal', full_name_he: 'ליה טל', club: null, country: 'ISR', gender: 'female' },
      { id: 'wy', full_name: 'Yael Young', full_name_he: 'יעל', club: 'Club C', country: 'ISR', gender: 'female' },
      { id: 'g2', full_name: 'Gali Two', full_name_he: 'גלי', club: 'Club C', country: 'ISR', gender: 'female' },
      { id: 'm1', full_name: 'Omer One', full_name_he: 'עומר', club: 'Club A', country: 'ISR', gender: 'male' },
      { id: 'm2', full_name: 'Ido Two', full_name_he: 'עידו', club: 'Club B', country: 'ISR', gender: 'male' },
      { id: 'm3', full_name: 'Ron Three', full_name_he: 'רון', club: null, country: 'ISR', gender: 'male' },
      { id: 'my', full_name: 'Yoni Young', full_name_he: 'יוני', club: null, country: 'ISR', gender: 'male' },
      // wn: no profile (shown as '?')
    ],
  };
}
