import { useFavorites } from '../lib/favorites';
import { useI18n } from '../lib/i18n';

/** ☆ / ★ toggle for following a climber. */
export function FavoriteStar({ climberId, name }: { climberId: string; name: string }) {
  const { t } = useI18n();
  const { has, toggle } = useFavorites();
  const on = has(climberId);
  return (
    <button type="button" className={`fav-star${on ? ' on' : ''}`} aria-pressed={on}
      aria-label={`${on ? t('unfollow') : t('follow')} ${name}`} title={on ? t('unfollow') : t('follow')}
      onClick={(e) => { e.preventDefault(); e.stopPropagation(); toggle(climberId); }}>
      {on ? '★' : '☆'}
    </button>
  );
}
