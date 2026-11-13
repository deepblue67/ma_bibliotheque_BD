-- ============================================================================
-- Ma Bibliothèque BD — version 3.6 : MON AVIS ET CARNET DE LECTURE
-- À exécuter UNE fois : Supabase → projet ma-bibliotheque-bd → SQL Editor → New query →
-- coller TOUT ce script → Run. Il peut être relancé sans risque (rien n'est effacé).
-- Retour arrière : supabase_avis_retour.sql (ATTENTION : il efface tous les avis).
-- Prérequis : supabase_securite.sql (3.2) déjà exécuté (fonction bd_proprietaire()).
-- ============================================================================
--
-- Table bd_avis : un avis par fiche (série ou one-shot), identifiée comme dans bd_status
-- (id de la fiche dans data/catalog.json). Note sur 10 facultative, date de lecture,
-- commentaire. PRIVÉE : lecture et écriture réservées au propriétaire connecté, comme les
-- favoris et les coches ; la clé publique (visiteurs) ne voit rien.

do $$
begin
  if to_regprocedure('public.bd_proprietaire()') is null then
    raise exception 'Lance d''abord supabase_securite.sql (version 3.2) : la fonction bd_proprietaire() manque.';
  end if;
end $$;

create table if not exists public.bd_avis (
  id          text primary key,
  note        smallint,
  lu_le       date,
  commentaire text,
  updated_at  timestamptz not null default now()
);

alter table public.bd_avis drop constraint if exists bd_avis_note;
alter table public.bd_avis add constraint bd_avis_note check (note is null or note between 0 and 10);
alter table public.bd_avis drop constraint if exists bd_avis_commentaire;
alter table public.bd_avis add constraint bd_avis_commentaire check (commentaire is null or char_length(commentaire) <= 4000);
alter table public.bd_avis drop constraint if exists bd_avis_contenu;
alter table public.bd_avis add constraint bd_avis_contenu check (note is not null or coalesce(commentaire, '') <> '');

alter table public.bd_avis enable row level security;

-- On repart de zéro pour les règles de cette table, quel que soit leur nom.
do $$
declare r record;
begin
  for r in select policyname from pg_policies where schemaname = 'public' and tablename = 'bd_avis'
  loop
    execute format('drop policy %I on public.bd_avis', r.policyname);
  end loop;
end $$;

create policy "proprietaire lit"      on public.bd_avis for select to authenticated using (public.bd_proprietaire());
create policy "proprietaire ajoute"   on public.bd_avis for insert to authenticated with check (public.bd_proprietaire());
create policy "proprietaire modifie"  on public.bd_avis for update to authenticated using (public.bd_proprietaire()) with check (public.bd_proprietaire());
create policy "proprietaire supprime" on public.bd_avis for delete to authenticated using (public.bd_proprietaire());

revoke all on public.bd_avis from anon;
grant select, insert, update, delete on public.bd_avis to authenticated;

-- Synchronisation en direct entre les appareils (comme bd_status), si elle n'y est pas déjà.
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables
                     where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'bd_avis') then
    alter publication supabase_realtime add table public.bd_avis;
  end if;
end $$;

-- Contrôle : 4 règles, et le nombre d'avis (0 au premier lancement).
select (select count(*) from pg_policies where schemaname = 'public' and tablename = 'bd_avis') as regles,
       (select count(*) from public.bd_avis) as avis;
