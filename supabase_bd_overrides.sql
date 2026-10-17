-- ============================================================================
-- Ma Bibliothèque BD — table des corrections faites depuis l'appli
-- À exécuter : Supabase → projet ma-bibliotheque-bd → SQL Editor → New query →
-- coller ce script → Run. Il peut être relancé sans risque, et DOIT l'être après
-- chaque lot qui le complète (dernier ajout : colonnes merged_into et not_dup, lot
-- « fusion et doublons probables »).
-- ============================================================================
--
-- Une ligne = une correction, rattachée soit à une fiche (id = id du catalogue,
-- ex. "Les_Foot_furieux_MANQUE_LE_28"), soit à un tome (id = "<id fiche>::<index>",
-- index d'origine à partir de 0, comme dans bd_volume_status).
-- Le catalogue (data/catalog.json, régénéré à chaque import) n'est jamais modifié :
-- l'appli applique ces corrections par-dessus, ce qui les rend insensibles aux
-- réimports tant que les identifiants restent stables.
--
--   hidden : true = masquée, false = démasquée explicitement (permet de ré-afficher
--            une fiche masquée par l'import), NULL = pas d'avis (valeur du catalogue)
--   title  : titre de la fiche, ou libellé du tome (NULL = celui du disque)
--   author : auteur(s), fiches seulement (NULL = celui du catalogue)
--   genre  : 0 à 2 genres de la liste fixe, fiches seulement (NULL = ceux du catalogue)
--   merged_into : id de la fiche dans laquelle celle-ci est fusionnée (ses tomes y sont
--            ajoutés à la fin, elle disparaît de la grille) ; NULL = pas de fusion
--   not_dup : true sur une ligne "nodup:<clé1>|<clé2>" = « pas un doublon », la
--            suggestion ne revient plus dans l'écran des doublons probables

create table if not exists public.bd_overrides (
  id          text primary key,
  hidden      boolean,
  title       text,
  author      text,
  genre       text[],
  merged_into text,
  not_dup     boolean,
  updated_at  timestamptz not null default now()
);

-- Table déjà créée par une version précédente du script : on ajoute les colonnes manquantes.
alter table public.bd_overrides add column if not exists merged_into text;
alter table public.bd_overrides add column if not exists not_dup boolean;

alter table public.bd_overrides enable row level security;

-- Lecture publique : les visiteurs doivent voir les titres corrigés et ne pas voir
-- les fiches masquées. Écriture et suppression avec la clé publique, comme pour
-- bd_status et bd_volume_status : seule l'interface (mode propriétaire) les limite.
drop policy if exists "public read"   on public.bd_overrides;
drop policy if exists "public insert" on public.bd_overrides;
drop policy if exists "public update" on public.bd_overrides;
drop policy if exists "public delete" on public.bd_overrides;
create policy "public read"   on public.bd_overrides for select using (true);
create policy "public insert" on public.bd_overrides for insert with check (true);
create policy "public update" on public.bd_overrides for update using (true);
create policy "public delete" on public.bd_overrides for delete using (true);

-- Synchro en direct entre tes appareils (ignore l'erreur si déjà fait).
do $$ begin
  alter publication supabase_realtime add table public.bd_overrides;
exception when duplicate_object then null;
end $$;
