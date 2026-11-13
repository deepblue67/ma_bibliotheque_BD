-- ============================================================================
-- Ma Bibliothèque BD — retour arrière de supabase_avis.sql (version 3.6)
-- ATTENTION : supprime la table bd_avis ET TOUS LES AVIS qu'elle contient, sans retour
-- possible. Avant, exporte-les : Réglages → Carnet de lecture → Exporter (CSV).
-- L'appli continue de marcher sans la table : « Mon avis » demande alors de lancer
-- supabase_avis.sql.
-- ============================================================================
drop table if exists public.bd_avis;
