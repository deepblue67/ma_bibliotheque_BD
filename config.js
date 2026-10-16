// Identifiants Supabase — l'anon key est une clé publique cliente,
// protégée par les policies RLS de la table bd_status (pas un secret serveur).
window.BD_SUPABASE_URL = "https://aotudxyifqhyazluxhko.supabase.co";
window.BD_SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFvdHVkeHlpZnFoeWF6bHV4aGtvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODgyOTExOTIsImV4cCI6MjEwMzg2NzE5Mn0.ute_fG7R3ZWQpaF0Ys1P_lvGBBZPMfQU6p0LCLprDQo";

// Les couvertures sont hébergées sur Supabase Storage (bucket public "covers"),
// pas dans le dépôt Git — le site les charge depuis cette base d'URL.
window.BD_IMAGE_BASE = "https://aotudxyifqhyazluxhko.supabase.co/storage/v1/object/public/covers/";

// Mode propriétaire : empreinte (PBKDF2) du code propriétaire, PAS le code lui-même.
// Vide = mode propriétaire non configuré : l'appli est en lecture seule pour tout le
// monde. Pour la remplir : Réglages → Mode propriétaire → « Générer l'empreinte », puis
// recopier ici la ligne affichée et publier.
window.BD_OWNER_HASH = "ff4fc89ec7b3ecf298f13defaa78e242e59e4a3c66d92e8ae4159f40e3d10e1a";
