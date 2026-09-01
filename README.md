# Ma Bibliothèque BD

Catalogue personnel de bandes dessinées de Christophe : recherche par titre/auteur, marquage "lu" et favoris synchronisés entre iPhone, iPad et PC. Site statique, sans backend applicatif — juste GitHub Pages + Supabase.

> **À faire vivre** : ce fichier doit être mis à jour à chaque changement fonctionnel, visuel ou technique. Il sert de mémoire au propriétaire du projet et de point de reprise rapide pour Claude/Codex lors d'une prochaine session.

## Vue d'ensemble de l'architecture

- **Site** : HTML/CSS/JS vanilla, aucun framework, aucune étape de build. Hébergé sur GitHub Pages.
- **Design** : direction "Kiosque BD" — style comic pulpe (police Bangers pour les titres, Archivo pour le reste, palette crème/rouge/noir, fond à trame demi-teinte dans le header). Choisie parmi 4 propositions présentées via un canvas Design (voir historique de conversation si besoin de revoir les 3 autres directions écartées : "Bibliothèque" épurée, "Atelier Noir" sombre, "Fiche d'Archive" catalogue).
- **Données** : `data/catalog.json`, généré une fois par un pipeline de scripts Python (voir plus bas), à régénérer à chaque ajout/retrait de BD dans la collection source.
- **Couvertures** : hébergées sur **Supabase Storage** (pas dans le dépôt Git — trop de fichiers, voir section dédiée), extraites automatiquement depuis la première page de chaque BD.
- **Synchro "lu"/"favoris"** : table Postgres sur **Supabase**, lue/écrite en direct par le navigateur (clé publique "anon"), avec Realtime pour propager les changements entre appareils sans recharger la page. Pas d'authentification (usage personnel mono-utilisateur).

## Structure des fichiers du site

```
ma-bibliotheque-bd/
├── index.html          # structure de la page (header recherche, grille, fiche détail)
├── style.css           # design "Kiosque BD", responsive (grid auto-fill, breakpoints mobile)
├── app.js              # toute la logique : chargement catalogue, recherche/filtres,
│                        #   rendu grille + fiche détail, lu/favoris, sync Supabase
├── config.js            # identifiants Supabase (URL + clé anon — publics, sans risque)
│                        #   + BD_IMAGE_BASE (préfixe des couvertures sur Supabase Storage)
├── data/
│   └── catalog.json     # catalogue généré (852 entrées) — voir schéma plus bas
├── covers/               # copie locale des couvertures — GITIGNORÉ, ne sert qu'à
│                        #   alimenter uploader.html, n'est PAS déployé
├── uploader.html         # outil à usage unique pour envoyer les couvertures vers
│                        #   Supabase Storage — GITIGNORÉ, ne doit jamais être publié
└── .gitignore            # exclut covers/ et uploader.html
```

### Schéma d'une entrée de `data/catalog.json`

```json
{
  "id": "Thorgal",                 // slug utilisé comme clé primaire dans bd_status
  "title": "Thorgal",
  "author": "Jean Van Hamme, Grzegorz Rosinski",
  "volume_count": 43,
  "volumes": ["La Magicienne trahie", "L'Île des Mers gelées", "..."],
  "cover": "Thorgal.jpg",           // nom de fichier sur Supabase Storage (bucket "covers")
  "parent_series": null             // ex: "Thorgal" pour l'entrée "Thorgal - Les mondes de Thorgal"
}
```

## Backend Supabase

- Projet : `ma-bibliotheque-bd` (org `deepblue67`), ref `aotudxyifqhyazluxhko`, région `eu-west-1` (Irlande).
- Project URL : `https://aotudxyifqhyazluxhko.supabase.co`
- La clé **anon** (publique, dans `config.js`) est protégée par les policies RLS ci-dessous — elle ne donne accès qu'à la table `bd_status` et à la lecture du bucket `covers`.
- La clé **service_role** (secrète) n'est utilisée QUE ponctuellement dans `uploader.html`, en local, jamais commitée. Si besoin de la retrouver : Project Settings → API Keys.

### Table `bd_status` (lu / favoris)

```sql
create table bd_status (
  id text primary key,              -- correspond à catalog.json[].id
  is_read boolean not null default false,
  is_favorite boolean not null default false,
  updated_at timestamptz not null default now()
);

alter table bd_status enable row level security;
create policy "public read" on bd_status for select using (true);
create policy "public upsert" on bd_status for insert with check (true);
create policy "public update" on bd_status for update using (true);

-- pour la synchro en temps réel entre appareils :
alter publication supabase_realtime add table bd_status;
```

### Bucket Storage `covers`

```sql
insert into storage.buckets (id, name, public) values ('covers', 'covers', true)
on conflict (id) do nothing;

create policy "public read covers" on storage.objects
for select using (bucket_id = 'covers');
```

Pas de policy d'écriture publique : l'envoi des couvertures se fait une fois via `uploader.html` avec la clé service_role (qui contourne RLS), pas via le site public.

**Contrainte importante** : les noms de fichiers dans le bucket doivent être **ASCII uniquement** (Supabase Storage rejette les accents avec une erreur `Invalid key`). C'est pour ça que `cover` dans catalog.json est un slug sans accents (ex: `Cedric.jpg`, pas `Cédric.jpg`) même si le `title` affiché garde ses accents.

## Pipeline de génération des données

Les BD sources vivent dans `D:\Christophe\Mes BD` (dossier = un titre, fichiers PDF/cbz/cbr = les tomes). Les scripts qui construisent `catalog.json` et les couvertures tournent **sur l'ordinateur de Christophe**, via des scripts Python situés dans `~/bd-catalog/` **côté VM Linux locale** (accessible uniquement par l'outil `device_bash` d'une session Claude liée à cet ordinateur — ce n'est PAS un dossier Windows classique, donc invisible dans l'Explorateur).

Étapes (dans l'ordre, chaque script lit la sortie du précédent) :

1. **`scan.py`** — parcourt `Mes BD`, exclut `1 2 3 A CLASSER`, `1 2 3 A TRIER` et tout dossier `Nouveau dossier*`. Pour chaque dossier-titre, liste les fichiers volumes directs + les sous-dossiers contenant eux-mêmes des volumes (sous-séries potentielles). → `scan.json`
2. **`extract_covers.py`** — extrait la 1ère page du 1er tome de chaque titre comme couverture JPEG (PyMuPDF pour PDF, zipfile+Pillow pour cbz). Les `.cbr` échouent (pas d'`unrar` disponible sur la VM) — géré au cas par cas. Tourne par lots de ~150s (la VM locale n'autorise pas de process en arrière-plan persistant entre deux appels `device_bash`). → `covers_manifest.json`, `covers/*.jpg`
3. **`extract_meta.py`** — lit le champ `Author` des métadonnées PDF de chaque 1er tome (rapide, pas de rendu de page). → `meta_manifest.json`
4. Classification heuristique (`looks_plausible`) pour ne garder que les auteurs PDF qui ressemblent à de vrais noms (filtre les tags de scan type "CDS", noms de sites, etc.) → `authors_from_metadata.json` (761/819 résolus automatiquement au premier passage).
5. Pour les titres restants sans auteur fiable, un **agent de recherche web** (bedetheque.com / bdgest.com) a été lancé une fois pour vérifier ~45 titres ambigus. Résultat codé en dur dans `assemble_catalog.py` (`AGENT_AUTHORS`, `NOT_FOUND`). Une poignée d'auteurs de franchises très connues ont été ajoutés à la main (`KNOWN_AUTHORS`).
6. **`assemble_catalog.py`** — le script pivot :
   - applique la logique d'auteur (`author_for()`) dans l'ordre : métadonnées PDF > connaissance générale > recherche agent > "non trouvé" ;
   - applique ~22 règles manuelles (dict `SPECIAL`) pour séparer les **vrais spin-offs** en entrées de catalogue distinctes (ex: `Donjon` → 6 cycles séparés, `Alix` → + Alix Senator/raconte/Origine/Odyssée, `Lucky Luke` → + Kid Lucky/HS/Vu par...) tout en **ignorant les doublons de scan** (ex: dossiers alternatifs de Tintin, double jeu PDF d'Astérix, compilations dupliquées de XIII) ;
   - → `final_catalog.json` (852 entrées finales, 845 avec auteur).
7. **`build_public_catalog.py`** — nettoie les noms de tomes affichés (retire le préfixe `<Série>_Tome_NN_` des noms de fichiers) et produit le JSON allégé destiné au site → `catalog_public.json`, copié tel quel vers `data/catalog.json` du site.
8. **`fix_ascii_covers.py`** — renomme en ASCII (sans accents) tout nom de couverture qui en contenait, met à jour `covers_manifest.json` et `final_catalog.json`/`catalog_public.json` en conséquence (nécessaire suite à l'échec initial de 188 uploads Supabase Storage sur des noms accentués).

**Pour ajouter de nouvelles BD à l'avenir** : soit relancer tout le pipeline depuis `scan.py` (le plus fiable, mais retraite tout), soit ajouter à la main une entrée dans `catalog_public.json` / `data/catalog.json` avec le même schéma, extraire sa couverture (1ère page du tome 1, format JPEG ~500px de large) et l'envoyer sur le bucket Supabase `covers` avec un nom de fichier ASCII. Rien d'autre à changer : `app.js` lit `data/catalog.json` dynamiquement.

## Points restés ouverts (au moment de la rédaction)

**7 BD sans auteur identifié**, même après recherche : *1984, Arena, Arsène Lupin, Climax, Forbidden Zone, RAF Royal Air Force, Utopie*. Champ `author` à `null` dans le catalogue — l'appli affiche "Auteur non renseigné".

**5 regroupements incertains**, tranchés par défaut mais à vérifier si l'occasion se présente :
- `Arcanes` / `Arcane Majeur` : lien entre les deux non confirmé.
- `Merlin` : regroupement des sous-dossiers "Le prophète" / "Merlin la quête de l'épée" à vérifier.
- `Michel Vaillant` : hypothèse que le sous-dossier `BD` (79 tomes) = série classique et le dossier direct (15 tomes) = série "Legends" séparée — pas confirmé.
- `Paradis perdu [HD]` / `Psaume 2` : doublon probable, un seul jeu conservé.
- `Thorgal` : nature du sous-dossier `Saga` incertaine.

## Développement local

⚠️ Ouvrir `index.html` en double-clic (protocole `file://`) **ne fonctionne pas** dans Chrome/Edge : le `fetch("data/catalog.json")` est bloqué par la politique CORS sur les fichiers locaux. Pour tester avant de publier :

```bash
cd ma-bibliotheque-bd
python -m http.server 8000
# puis ouvrir http://localhost:8000
```

Ou plus simple : pousser directement sur GitHub Pages (qui sert en https, aucun souci de CORS) et tester en ligne.

## Déploiement

1. `covers/` et `uploader.html` sont exclus via `.gitignore` — le commit ne contient que le code + `data/catalog.json` (quelques centaines de Ko).
2. Pousser sur GitHub (dépôt `ma-bibliotheque-bd`, via GitHub Desktop).
3. Settings → Pages → source = branche `main`, dossier racine.
4. Site en ligne à `https://<pseudo-github>.github.io/ma-bibliotheque-bd/` après 1-2 minutes.
5. Le lien n'est indexé nulle part mais reste techniquement accessible à qui aurait l'URL exacte (pas de mot de passe sans offre GitHub payante).

## Historique des décisions notables

- Choix initial entre Firebase et Supabase pour la synchro : **Supabase**, car Christophe l'utilise déjà.
- Choix du mode de publication GitHub : Christophe pousse lui-même (pas d'accès token donné à Claude).
- Les couvertures ont d'abord été prévues dans le dépôt Git, puis déplacées vers Supabase Storage après retour de Christophe ("trop de covers à déposer sous git").
- Design retenu : direction "A — Kiosque BD" (comic pulpe), parmi 4 propositions.
