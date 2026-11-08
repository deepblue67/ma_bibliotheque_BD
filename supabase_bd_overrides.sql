-- ============================================================================
-- Ma Bibliothèque BD — table des corrections faites depuis l'appli
-- À exécuter : Supabase → projet ma-bibliotheque-bd → SQL Editor → New query →
-- coller ce script → Run. Il peut être relancé sans risque, et DOIT l'être après
-- chaque lot qui le complète (dernier ajout : colonne owner_only, version 2.9,
-- « fiches réservées au propriétaire »). Depuis la 3.2, les règles d'accès sont dans
-- supabase_securite.sql.
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
--   owner_only : true = fiche réservée au propriétaire (2.9) : l'appli ne la montre pas
--            aux visiteurs. C'est de la discrétion, pas un secret : le catalogue et les
--            couvertures restent publics pour qui les cherche.

create table if not exists public.bd_overrides (
  id          text primary key,
  hidden      boolean,
  title       text,
  author      text,
  genre       text[],
  merged_into text,
  not_dup     boolean,
  owner_only  boolean,
  updated_at  timestamptz not null default now()
);

-- Table déjà créée par une version précédente du script : on ajoute les colonnes manquantes.
alter table public.bd_overrides add column if not exists merged_into text;
alter table public.bd_overrides add column if not exists not_dup boolean;
alter table public.bd_overrides add column if not exists owner_only boolean;

alter table public.bd_overrides enable row level security;

-- Règles d'accès : depuis la version 3.2, elles sont posées par supabase_securite.sql
-- (lecture pour tous, écriture réservée au propriétaire connecté). Ce script n'y touche
-- plus, pour ne jamais rouvrir les écritures à la clé publique s'il est relancé.
-- Table toute neuve (aucune règle encore) : lancer ensuite supabase_securite.sql.

-- Synchro en direct entre tes appareils (ignore l'erreur si déjà fait).
do $$ begin
  alter publication supabase_realtime add table public.bd_overrides;
exception when duplicate_object then null;
end $$;
