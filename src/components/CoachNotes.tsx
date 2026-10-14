import { useEffect, useState, type FormEvent } from 'react';
import { useAuth } from '../lib/auth';
import { useI18n } from '../lib/i18n';
import { supabase } from '../lib/supabase';

interface Note { id: string; body: string; shared_with_climber: boolean; created_at: string }

/**
 * Coach notes for one climber. RLS decides what comes back: the authoring coach sees all
 * of their notes; the climber sees only notes shared with them; nobody else sees any.
 */
export function CoachNotes({ climberId, canWrite }: { climberId: string; canWrite: boolean }) {
  const { t, lang } = useI18n();
  const { session } = useAuth();
  const [notes, setNotes] = useState<Note[]>([]);
  const [body, setBody] = useState('');
  const [shared, setShared] = useState(false);

  const load = () => supabase.from('coach_notes').select('id, body, shared_with_climber, created_at')
    .eq('climber_id', climberId).order('created_at', { ascending: false })
    .then(({ data }) => setNotes((data as Note[]) ?? []));

  useEffect(() => { void load(); }, [climberId]);

  async function add(e: FormEvent) {
    e.preventDefault();
    if (!session || !body.trim()) return;
    const { error } = await supabase.from('coach_notes')
      .insert({ coach_id: session.user.id, climber_id: climberId, body: body.trim(), shared_with_climber: shared });
    if (!error) { setBody(''); setShared(false); void load(); }
  }

  return (
    <div className="panel">
      <h2>{t('notes')}</h2>
      {canWrite && (
        <form className="form" onSubmit={add}>
          <textarea rows={3} value={body} onChange={(e) => setBody(e.target.value)} maxLength={5000} />
          <label className="inline">
            <input type="checkbox" checked={shared} onChange={(e) => setShared(e.target.checked)} /> {t('shareWithAthlete')}
          </label>
          <button className="primary">{t('addNote')}</button>
        </form>
      )}
      {notes.length === 0 && <p className="muted">{t('empty')}</p>}
      <ul className="notes">
        {notes.map((n) => (
          <li key={n.id}>
            <span className="muted small">
              {new Date(n.created_at).toLocaleDateString(lang === 'he' ? 'he-IL' : 'en-GB')}
              {canWrite && n.shared_with_climber && ` · ${t('shareWithAthlete')}`}
            </span>
            <p>{n.body}</p>
          </li>
        ))}
      </ul>
    </div>
  );
}
