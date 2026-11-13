-- ============================================================================
-- Ma Bibliothèque BD — version 3.4 : RÉGLAGES DU SITE (présentation des visiteurs)
-- À exécuter UNE fois : Supabase → projet ma-bibliotheque-bd → SQL Editor → New query →
-- coller TOUT ce script → Run. Il peut être relancé sans risque (rien n'est effacé).
-- Retour arrière : supabase_reglages_retour.sql.
-- Prérequis : supabase_securite.sql (3.2) déjà exécuté (fonction bd_proprietaire()).
-- ============================================================================
--
-- Table bd_reglages : une ligne par réglage du site (clé → valeur). Pour l'instant une
-- seule : « presentation », la présentation sur laquelle arrive un visiteur qui n'a rien
-- choisi sur son appareil (grille, eventail, etagere, mur ou liste).
-- Lecture pour tout le monde (les visiteurs doivent la connaître), écriture réservée au
-- propriétaire connecté (Réglages → Présentation → « Pour tes visiteurs »). Pas de
-- suppression depuis l'appli.

do $$
begin
  if to_regprocedure('public.bd_proprietaire()') is null then
    raise exception 'Lance d''abord supabase_securite.sql (version 3.2) : la fonction bd_proprietaire() manque.';
  end if;
end $$;

create table if not exists public.bd_reglages (
  cle        text primary key,
  valeur     text not null,
  updated_at timestamptz not null default now()
);

alter table public.bd_reglages drop constraint if exists bd_reglages_presentation;
alter table public.bd_reglages add constraint bd_reglages_presentation
  check (cle <> 'presentation' or valeur in ('grille', 'eventail', 'etagere', 'mur', 'liste'));

alter table public.bd_reglages enable row level security;

-- On repart de zéro pour les règles de cette table, quel que soit leur nom.
do $$
declare r record;
begin
  for r in select policyname from pg_policies where schemaname = 'public' and tablename = 'bd_reglages'
  loop
    execute format('drop policy %I on public.bd_reglages', r.policyname);
  end loop;
end $$;

create policy "tout le monde lit"    on public.bd_reglages for select to anon, authenticated using (true);
create policy "proprietaire ajoute"  on public.bd_reglages for insert to authenticated with check (public.bd_proprietaire());
create policy "proprietaire modifie" on public.bd_reglages for update to authenticated using (public.bd_proprietaire()) with check (public.bd_proprietaire());

grant select on public.bd_reglages to anon, authenticated;
grant insert, update on public.bd_reglages to authenticated;

insert into public.bd_reglages (cle, valeur) values ('presentation', 'grille')
on conflict (cle) do nothing;

-- Contrôle : une ligne « presentation » et 3 règles.
select r.cle, r.valeur, (select count(*) from pg_policies p
                         where p.schemaname = 'public' and p.tablename = 'bd_reglages') as regles
from public.bd_reglages r order by r.cle;
