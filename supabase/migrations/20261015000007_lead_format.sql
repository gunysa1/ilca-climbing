-- Lead scoring format. Own migration: a new enum value can't be used in the transaction that adds it.
alter type public.scoring_format add value if not exists 'lead';
