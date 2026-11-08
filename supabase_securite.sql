-- ============================================================================
-- Ma Bibliothèque BD — version 3.2 : VERROU DES ÉCRITURES (sécurité, étape 2)
-- À exécuter : Supabase → projet ma-bibliotheque-bd → SQL Editor → New query →
-- coller TOUT ce script → Run. Il peut être relancé sans risque.
-- Retour arrière (rouvrir comme avant) : supabase_securite_retour.sql.
-- ============================================================================
--
-- Avant : la clé publique (anon, dans config.js) pouvait lire et écrire les trois tables.
-- Après :
--   bd_status, bd_volume_status (favoris, coches de lecture) : lecture ET écriture
--     réservées au propriétaire connecté (Réglages → Mode propriétaire → Connexion sécurisée) ;
--   bd_overrides (corrections, masquages, fusions, fiches privées) : lecture pour tout le
--     monde (les visiteurs doivent voir les titres corrigés et ne pas voir les fiches
--     masquées), écriture réservée au propriétaire connecté.
--
-- « Propriétaire connecté » = une session Supabase Auth ordinaire (rôle authenticated),
-- non anonyme. Ça suffit parce que les inscriptions sont FERMÉES (Authentication → Sign In
-- / Providers → « Allow new users to sign up » désactivé) : le seul compte est celui créé à
-- la main. On ne fige pas l'identifiant du compte : s'il faut le recréer (mot de passe
-- oublié), rien n'est à changer ici. À NE PAS FAIRE : rouvrir les inscriptions, ou activer
-- les connexions anonymes sans garder le test is_anonymous ci-dessous.
--
-- Les couvertures (bucket covers) ne changent pas : lecture publique, envoi avec la clé
-- service_role (uploader.html), qui passe outre ces règles.

create or replace function public.bd_proprietaire()
returns boolean
language sql
stable
set search_path = ''
as $$
  select coalesce(auth.jwt() ->> 'role', '') = 'authenticated'
     and coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) = false
$$;

-- On repart de zéro : toutes les règles existantes des trois tables sont supprimées,
-- quel que soit leur nom.
do $$
declare r record;
begin
  for r in select policyname, tablename from pg_policies
           where schemaname = 'public' and tablename in ('bd_status', 'bd_volume_status', 'bd_overrides')
  loop
    execute format('drop policy %I on public.%I', r.policyname, r.tablename);
  end loop;
end $$;

alter table public.bd_status        enable row level security;
alter table public.bd_volume_status enable row level security;
alter table public.bd_overrides     enable row level security;

-- Favoris et coches : rien pour les visiteurs.
create policy "proprietaire lit"      on public.bd_status for select to authenticated using (public.bd_proprietaire());
create policy "proprietaire ajoute"   on public.bd_status for insert to authenticated with check (public.bd_proprietaire());
create policy "proprietaire modifie"  on public.bd_status for update to authenticated using (public.bd_proprietaire()) with check (public.bd_proprietaire());
create policy "proprietaire supprime" on public.bd_status for delete to authenticated using (public.bd_proprietaire());

create policy "proprietaire lit"      on public.bd_volume_status for select to authenticated using (public.bd_proprietaire());
create policy "proprietaire ajoute"   on public.bd_volume_status for insert to authenticated with check (public.bd_proprietaire());
create policy "proprietaire modifie"  on public.bd_volume_status for update to authenticated using (public.bd_proprietaire()) with check (public.bd_proprietaire());
create policy "proprietaire supprime" on public.bd_volume_status for delete to authenticated using (public.bd_proprietaire());

-- Corrections : lecture pour tous, écriture pour le propriétaire.
create policy "tout le monde lit"     on public.bd_overrides for select to anon, authenticated using (true);
create policy "proprietaire ajoute"   on public.bd_overrides for insert to authenticated with check (public.bd_proprietaire());
create policy "proprietaire modifie"  on public.bd_overrides for update to authenticated using (public.bd_proprietaire()) with check (public.bd_proprietaire());
create policy "proprietaire supprime" on public.bd_overrides for delete to authenticated using (public.bd_proprietaire());

-- Contrôle : la liste doit montrer 12 règles (4 par table).
select tablename, policyname, cmd, roles from pg_policies
where schemaname = 'public' and tablename in ('bd_status', 'bd_volume_status', 'bd_overrides')
order by tablename, cmd;
