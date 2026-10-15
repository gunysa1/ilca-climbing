import { useEffect, useState, type FormEvent } from 'react';
import { useAuth } from '../lib/auth';
import { useI18n } from '../lib/i18n';
import { supabase } from '../lib/supabase';

interface Note { id: string; body: string; created_at: string }

/** A coach's private notes on one of their climbers (RLS: only the authoring coach reads them). */
export function CoachNotes({ climberId }: { climberId: string }) {
  const { t, lang } = useI18n();
  const { profileId } = useAuth();
  const [notes, setNotes] = useState<Note[]>([]);
  const [body, setBody] = useState('');

  const load = () => supabase.from('coach_notes').select('id, body, created_at')
    .eq('climber_id', climberId).order('created_at', { ascending: false })
    .then(({ data }) => setNotes((data as Note[]) ?? []));

  useEffect(() => { void load(); }, [climberId]);

  async function add(e: FormEvent) {
    e.preventDefault();
    if (!profileId || !body.trim()) return;
    const { error } = await supabase.from('coach_notes')
      .insert({ coach_id: profileId, climber_id: climberId, body: body.trim() });
    if (!error) { setBody(''); void load(); }
  }

  return (
    <div className="panel">
      <h2>{t('notes')}</h2>
      <form className="form" onSubmit={add}>
        <textarea rows={3} value={body} onChange={(e) => setBody(e.target.value)} maxLength={5000} />
        <button className="primary">{t('addNote')}</button>
      </form>
      {notes.length === 0 && <p className="muted">{t('empty')}</p>}
      <ul className="notes">
        {notes.map((n) => (
          <li key={n.id}>
            <span className="muted small">{new Date(n.created_at).toLocaleDateString(lang === 'he' ? 'he-IL' : 'en-GB')}</span>
            <p>{n.body}</p>
          </li>
        ))}
      </ul>
    </div>
  );
}
