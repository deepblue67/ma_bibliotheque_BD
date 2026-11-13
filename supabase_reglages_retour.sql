-- ============================================================================
-- Ma Bibliothèque BD — retour arrière de supabase_reglages.sql (version 3.4)
-- Supprime la table bd_reglages (et ses règles). L'appli continue de marcher : sans la
-- table, chaque visiteur arrive sur la grille ou sur la présentation choisie sur son appareil.
-- ============================================================================
drop table if exists public.bd_reglages;
