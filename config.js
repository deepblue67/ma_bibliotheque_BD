// Identifiants Supabase — l'anon key est une clé publique cliente (pas un secret serveur) :
// depuis la 3.2, les règles RLS (supabase_securite.sql) ne lui permettent que de lire les
// corrections et les couvertures ; tout le reste demande la connexion du propriétaire.
window.BD_SUPABASE_URL = "https://aotudxyifqhyazluxhko.supabase.co";
window.BD_SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFvdHVkeHlpZnFoeWF6bHV4aGtvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODgyOTExOTIsImV4cCI6MjEwMzg2NzE5Mn0.ute_fG7R3ZWQpaF0Ys1P_lvGBBZPMfQU6p0LCLprDQo";

// Les couvertures sont hébergées sur Supabase Storage (bucket public "covers"),
// pas dans le dépôt Git — le site les charge depuis cette base d'URL.
window.BD_IMAGE_BASE = "https://aotudxyifqhyazluxhko.supabase.co/storage/v1/object/public/covers/";

// Mode propriétaire (depuis la 3.3) : un appareil est propriétaire quand il est connecté à
// Supabase (Réglages → Mode propriétaire, e-mail + mot de passe). L'ancienne empreinte du
// code propriétaire (BD_OWNER_HASH) a été retirée : elle ne sert plus à rien.
