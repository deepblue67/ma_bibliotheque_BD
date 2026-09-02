# Ma Bibliothèque BD

Catalogue personnel de bandes dessinées de Christophe : recherche par titre/auteur, marquage "lu" **par tome** (le titre passe "lu" automatiquement quand tous ses tomes le sont) et favoris **par titre**, synchronisés entre iPhone, iPad et PC. Cliquer sur un tome dans la fiche détail affiche sa propre couverture. Site statique, sans backend applicatif — juste GitHub Pages + Supabase.

> **À faire vivre** : ce fichier doit être mis à jour à chaque changement fonctionnel, visuel ou technique. Il sert de mémoire au propriétaire du projet et de point de reprise rapide pour Claude/Codex lors d'une prochaine session.

## Vue d'ensemble de l'architecture

- **Site** : HTML/CSS/JS vanilla, aucun framework, aucune étape de build. Hébergé sur GitHub Pages.
- **Design** : direction "Kiosque BD" — style comic pulpe (police Bangers pour les titres, Archivo pour le reste, palette crème/rouge/noir, fond à trame demi-teinte dans le header). Choisie parmi 4 propositions présentées via un canvas Design (voir historique de conversation si besoin de revoir les 3 autres directions écartées : "Bibliothèque" épurée, "Atelier Noir" sombre, "Fiche d'Archive" catalogue).
- **Données** : `data/catalog.json`, généré une fois par un pipeline de scripts Python (voir plus bas), à régénérer à chaque ajout/retrait de BD dans la collection source.
- **Couvertures** : hébergées sur **Supabase Storage** (pas dans le dépôt Git — trop de fichiers, voir section dédiée), **une par tome** (extraites automatiquement depuis la première page de chaque fichier PDF/cbz).
- **Synchro "lu"/"favoris"** : deux tables Postgres sur **Supabase** (`bd_volume_status` pour le "lu" par tome, `bd_status` pour les favoris par titre), lues/écrites en direct par le navigateur (clé publique "anon"), avec Realtime pour propager les changements entre appareils sans recharger la page. Pas d'authentification (usage personnel mono-utilisateur).

## Structure des fichiers du site

```
ma-bibliotheque-bd/
├── index.html          # structure de la page (header recherche, grille, fiche détail)
├── style.css           # design "Kiosque BD", responsive (grid auto-fill, breakpoints mobile)
├── app.js              # toute la logique : chargement catalogue, recherche/filtres,
│                        #   rendu grille + fiche détail, lu par tome (calcul du "lu" titre),
│                        #   favoris par titre, aperçu couverture par tome, sync Supabase
├── config.js            # identifiants Supabase (URL + clé anon — publics, sans risque)
│                        #   + BD_IMAGE_BASE (préfixe des couvertures sur Supabase Storage)
├── apple-touch-icon.png  # icône écran d'accueil iPad/iPhone (180×180, convention racine)
├── favicon.ico           # favicon multi-résolution (onglet navigateur)
├── site.webmanifest      # manifest PWA (icônes Android/Chrome, nom, couleurs)
├── icons/                 # déclinaisons de tailles de l'icône (apple-touch-icon-*, favicon-*,
│                        #   android-chrome-*) — voir section dédiée plus bas
├── genre_map.json         # id -> {genres, confidence, source} — modifiable à la main,
│                        #   lu par build_public_catalog_v2.py (voir section "Genres")
├── genre_taxonomy.json    # liste fixe des genres, informatif (la vraie source pour l'appli
│                        #   est le tableau GENRES dans app.js)
├── data/
│   └── catalog.json     # catalogue généré (852 entrées) — voir schéma plus bas
├── volume_covers/        # copie locale des couvertures (une par TOME, ~6275 fichiers)
│                        #   — GITIGNORÉ, ne sert qu'à alimenter uploader.html
├── covers/               # ancien dossier (couverture par TITRE) — obsolète, gardé
│                        #   gitignoré, peut être supprimé
├── uploader.html         # outil pour envoyer les couvertures vers Supabase Storage
│                        #   (sélectionner "volume_covers") — GITIGNORÉ, jamais publié
└── .gitignore            # exclut covers/ et uploader.html
```

### Schéma d'une entrée de `data/catalog.json`

Depuis le passage au **suivi de lecture par tome**, chaque volume a sa propre couverture (et plus seulement le titre) :

```json
{
  "id": "Thorgal",                 // slug utilisé comme clé primaire dans bd_status ET comme préfixe des id de bd_volume_status
  "title": "Thorgal",
  "author": "Jean Van Hamme, Grzegorz Rosinski",
  "volume_count": 43,
  "volumes": [
    { "label": "La Magicienne trahie", "cover": "Thorgal_001.jpg" },
    { "label": "L'Île des Mers gelées", "cover": "Thorgal_002.jpg" }
  ],
  "cover": "Thorgal_001.jpg",       // = volumes[0].cover, utilisé pour la vignette de la grille
  "parent_series": null,            // ex: "Thorgal" pour l'entrée "Thorgal - Les mondes de Thorgal"
  "genre": ["Fantasy", "Aventure"]  // 0 à 2 valeurs, tirées de la liste fixe — voir section "Genres"
}
```

`cover` (au niveau tome ou titre) peut être `null` si l'extraction a échoué pour ce fichier (ex : `.cbr`, PDF corrompu) — l'appli affiche alors une case vide à la place de l'image.

## Backend Supabase

- Projet : `ma-bibliotheque-bd` (org `deepblue67`), ref `aotudxyifqhyazluxhko`, région `eu-west-1` (Irlande).
- Project URL : `https://aotudxyifqhyazluxhko.supabase.co`
- La clé **anon** (publique, dans `config.js`) est protégée par les policies RLS ci-dessous — elle ne donne accès qu'aux tables `bd_status` / `bd_volume_status` et à la lecture du bucket `covers`.
- La clé **service_role** (secrète) n'est utilisée QUE ponctuellement dans `uploader.html`, en local, jamais commitée. Si besoin de la retrouver : Project Settings → API Keys.

### Table `bd_status` (favoris — au niveau du titre)

Depuis le passage au suivi par tome, cette table ne gère plus que les **favoris**. La colonne `is_read` existe encore pour compat mais n'est plus utilisée par l'appli (le statut "lu" d'un titre est désormais calculé, voir plus bas).

```sql
create table bd_status (
  id text primary key,              -- correspond à catalog.json[].id
  is_read boolean not null default false,   -- non utilisée depuis le suivi par tome
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

### Table `bd_volume_status` (lu — au niveau du tome)

```sql
create table bd_volume_status (
  id text primary key,              -- "<titleId>::<index 0-based>", ex: "Thorgal::0"
  title_id text not null,
  is_read boolean not null default false,
  updated_at timestamptz not null default now()
);

alter table bd_volume_status enable row level security;
create policy "public read" on bd_volume_status for select using (true);
create policy "public upsert" on bd_volume_status for insert with check (true);
create policy "public update" on bd_volume_status for update using (true);

alter publication supabase_realtime add table bd_volume_status;
```

Le titre est affiché "Lu" dans l'appli quand **tous** ses tomes sont marqués lus (calculé côté client dans `app.js`, `isTitleRead()`) — rien à stocker côté titre pour ça.

### Bucket Storage `covers`

```sql
insert into storage.buckets (id, name, public) values ('covers', 'covers', true)
on conflict (id) do nothing;

create policy "public read covers" on storage.objects
for select using (bucket_id = 'covers');
```

Pas de policy d'écriture publique : l'envoi des couvertures se fait via `uploader.html` avec la clé service_role (qui contourne RLS), pas via le site public.

**Contrainte importante** : les noms de fichiers dans le bucket doivent être **ASCII uniquement** (Supabase Storage rejette les accents avec une erreur `Invalid key`). C'est pour ça que chaque `cover` dans catalog.json est un nom sans accents (ex: `Thorgal_001.jpg`) même si le `title`/`label` affiché garde ses accents.

## Icône écran d'accueil (iPad / iPhone / Android)

Le site déclare une icône pour "Ajouter à l'écran d'accueil" (Safari iOS/iPadOS) et pour l'installation en PWA sous Chrome/Android :

- `apple-touch-icon.png` (180×180, à la racine) + variantes `icons/apple-touch-icon-{120,152,167,180}x180.png` référencées explicitement dans `<head>` (`<link rel="apple-touch-icon" sizes="…">`), pour couvrir tous les formats d'appareils Apple.
- `favicon.ico` + `icons/favicon-{16,32}x32.png` pour l'onglet navigateur (corrige au passage l'ancienne erreur 404 sur le favicon visible dans la console).
- `icons/android-chrome-{192,512}x512.png` + `site.webmanifest` pour Android/Chrome (nom "Ma Bibliothèque BD", couleur de thème rouge `#c1272d`, mode `standalone`).
- Design retenu : bulle de BD rouge "BD" avec une petite bulle "?!" en accent dans le coin (parmi plusieurs séries de propositions présentées à Christophe — voir historique de conversation pour les pistes écartées).

Toutes ces images sont générées depuis un seul visuel maître 1024×1024 (script Python + `cairosvg`, hors dépôt) puis redimensionnées ; pour changer l'icône plus tard, il suffit de refournir un nouveau visuel maître et de relancer l'export vers les mêmes noms de fichiers (pas besoin de retoucher le HTML).

⚠️ iOS met l'icône en cache assez agressivement une fois qu'un raccourci existe déjà sur l'écran d'accueil : si Christophe avait déjà ajouté le site à son écran d'accueil avant ce changement, il faut supprimer l'ancien raccourci et refaire "Ajouter à l'écran d'accueil" pour voir la nouvelle icône (recharger la page dans Safari ne suffit pas).

## Cache navigateur — convention de version

`index.html` charge `style.css`, `config.js` et `app.js` avec un suffixe `?v=N` (ex: `app.js?v=2`). **À chaque modification de l'un de ces trois fichiers, il faut incrémenter son `?v=` dans `index.html`**, sinon certains navigateurs continuent de servir l'ancienne version en cache après un simple rechargement (vécu : un `app.js` mis à jour restait invisible malgré plusieurs rechargements, jusqu'à un vidage de cache complet). `data/catalog.json` n'a pas ce problème : il est chargé via `fetch(..., { cache: "no-store" })` dans `app.js`, donc toujours à jour sans rien à incrémenter.

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
7. **`fix_ascii_covers.py`** — (historique) renomme en ASCII tout nom de couverture par TITRE qui en contenait — n'est plus utilisé depuis le passage aux couvertures par tome (l'étape 8 ci-dessous produit directement des noms ASCII).
8. **`extract_volume_covers.py`** — extrait une couverture JPEG pour **chaque tome** de chaque titre (pas seulement le 1er), avec un nom de fichier ASCII généré directement (`<prefixe_titre_ascii>_<NNN>.jpg`, préfixe dédupliqué stocké dans `volume_prefix_map.json`). Même logique PyMuPDF/zipfile+Pillow que `extract_covers.py`, même contrainte `.cbr` non supporté, même fonctionnement par lots resumable (`volume_covers_manifest.json` comme checkpoint, appelé en boucle avec un budget de ~150s). → `volume_covers/*.jpg` (~6275 fichiers sur 6323 tomes ; le reste = `.cbr` ou fichiers illisibles, `cover: null` dans le catalogue).
9. **`build_public_catalog_v2.py`** — nettoie les noms de tomes affichés (retire le préfixe `<Série>_Tome_NN_`) et associe à chaque tome sa couverture individuelle (`volume_covers_manifest.json`) → `catalog_public_v2.json`, copié vers `data/catalog.json` du site. `volumes` y est un tableau d'objets `{label, cover}` (voir schéma plus haut) au lieu d'un simple tableau de libellés. Depuis l'ajout du genre, ce même script lit aussi `genre_map.json` (voir section "Genres" ci-dessous) et ajoute le champ `genre` à chaque entrée.

**Pour ajouter de nouvelles BD à l'avenir** : relancer le pipeline à partir de `scan.py` (le plus fiable), puis `extract_volume_covers.py` et `build_public_catalog_v2.py`. Envoyer les nouveaux fichiers de `volume_covers/` sur le bucket Supabase `covers` via `uploader.html` (`upsert:true`, donc rejouer l'envoi complet ne casse rien). Penser aussi à classifier le genre des nouveaux titres dans `genre_map.json` (sinon ils sortent avec `"genre": []`, donc invisibles au filtre genre) — le plus simple est de demander à Claude de le faire lors de la session qui traite l'ajout. Rien d'autre à changer : `app.js` lit `data/catalog.json` dynamiquement.

## Genres

Chaque titre a 0 à 2 genres (`catalog.json` → champ `genre`, tableau), tirés d'une **liste fixe** (pas de texte libre) — actuellement :

`Aventure, Biographie, Documentaire, Drame / Chronique sociale, Fantastique / Horreur, Fantasy, Guerre, Historique, Humour, Jeunesse, Policier / Thriller, Science-fiction, Super-héros, Western`

Cette liste vit à deux endroits qui doivent rester synchronisés : `genre_taxonomy.json` (à la racine du dossier du site, purement informatif) et le tableau `GENRES` en haut de `app.js` (qui peuple réellement le menu déroulant de filtre). **Pour ajouter un genre à la liste** : l'ajouter aux deux, puis reclassifier les titres concernés dans `genre_map.json`.

**Comment la classification initiale a été faite** (852 titres, aucune info de genre dans les métadonnées des fichiers) :
1. **Passe 1 — connaissance générale** : le catalogue a été réparti en lots, chacun classifié par un agent à partir de sa connaissance des séries BD, avec un niveau de confiance ("high" seulement si la série est vraiment reconnue). 342 titres résolus avec confiance.
2. **Passe 2 — recherche web ciblée** : pour les ~510 titres restants (peu/pas connus, souvent avec `author: null`), des agents ont cherché chaque titre sur bedetheque.com, bdgest.com, Wikipedia, etc. Le quota de recherche web de la session a été atteint avant la fin (partagé entre tous les agents en parallèle) : 174 titres ont pu être vérifiés en ligne ; pour le reste, l'estimation de la passe 1 a été conservée telle quelle (non vérifiée) ; 46 titres restent sans genre du tout (aucune piste trouvable — souvent des titres génériques ou très confidentiels).

Résultat : `genre_map.json` (id → `{genres, confidence, source}`) — `confidence: "low"` signale un genre à prendre avec réserve. Contrairement aux autres manifestes du pipeline (qui restent sur la VM Linux locale, invisibles depuis Windows), **`genre_map.json` et `genre_taxonomy.json` sont placés directement à la racine du dossier `ma-bibliotheque-bd`**, donc visibles et modifiables dans l'Explorateur — c'est fait exprès, puisque c'est le seul fichier du pipeline pensé pour être corrigé à la main. Si tu repères une erreur en parcourant l'appli, le plus simple reste de me le signaler, mais tu peux aussi éditer directement la ligne correspondante dans `genre_map.json` toi-même — il suffit ensuite de redemander à Claude de relancer `build_public_catalog_v2.py` (script resté côté VM) pour régénérer `data/catalog.json`. Ces deux fichiers ne sont pas gitignorés : ils partent avec le reste du dépôt lors du push (ce sont de petits fichiers texte, sans problème de volume comme les couvertures).

## Points restés ouverts (au moment de la rédaction)

**46 BD sans genre identifié** (voir section "Genres" ci-dessus pour la méthode) — champ `genre: []`, invisibles au filtre genre tant qu'elles n'ont pas été classées manuellement dans `genre_map.json`. Par ailleurs, une bonne partie des genres non vérifiés en ligne (`confidence: "low"` dans `genre_map.json`) restent des estimations à corriger au fil de l'eau si une erreur saute aux yeux.

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

1. `covers/`, `volume_covers/` et `uploader.html` sont exclus via `.gitignore` — le commit ne contient que le code + `data/catalog.json` (quelques centaines de Ko).
2. Pousser sur GitHub (dépôt `ma-bibliotheque-bd`, via GitHub Desktop).
3. Settings → Pages → source = branche `main`, dossier racine.
4. Site en ligne à `https://<pseudo-github>.github.io/ma-bibliotheque-bd/` après 1-2 minutes.
5. Le lien n'est indexé nulle part mais reste techniquement accessible à qui aurait l'URL exacte (pas de mot de passe sans offre GitHub payante).

## Historique des décisions notables

- Choix initial entre Firebase et Supabase pour la synchro : **Supabase**, car Christophe l'utilise déjà.
- Choix du mode de publication GitHub : Christophe pousse lui-même (pas d'accès token donné à Claude).
- Les couvertures ont d'abord été prévues dans le dépôt Git, puis déplacées vers Supabase Storage après retour de Christophe ("trop de covers à déposer sous git").
- Design retenu : direction "A — Kiosque BD" (comic pulpe), parmi 4 propositions.
- Bug corrigé : la fiche détail (`#overlay`) restait affichée après clic sur fermer / clic hors-fiche. Cause : `.overlay { display:flex }` dans `style.css` écrasait le `display:none` natif associé à l'attribut HTML `hidden` (une règle CSS d'auteur passe toujours devant celle du navigateur). Fix : ajout de `.overlay[hidden] { display: none; }`.
- Bug corrigé : certaines vignettes de la grille restaient vides alors que leur image existait bien et s'affichait correctement dans la fiche détail. Cause : l'attribut `loading="lazy"` des `<img>` de la grille, peu fiable dans ce contexte (chargement jamais déclenché pour certaines images, même visibles à l'écran). Fix : chargement immédiat (pas de `loading="lazy"`) sur les vignettes de la grille — léger surcoût de bande passante à l'ouverture de l'appli (toutes les vignettes visibles se chargent d'un coup), sans impact pratique vu le volume (~850 vignettes, quelques dizaines de Ko chacune).
- Évolution majeure : passage du suivi "lu" du niveau titre au niveau **tome**, avec calcul automatique du statut du titre (tous les tomes lus ⇒ titre lu) et un bouton "Tout marquer comme lu" en raccourci. Ajout d'une couverture par tome (extraction étendue de 852 à 6323 images) affichée en cliquant sur un tome dans la fiche détail (remplace la grande couverture en haut). Nouvelle table Supabase `bd_volume_status` ; `bd_status` ne gère plus que les favoris.
- Fonctionnalité ajoutée : icône d'écran d'accueil iPad/iPhone/Android (`apple-touch-icon`, favicon, manifest PWA). Plusieurs séries de propositions visuelles soumises à Christophe (styles "kiosque BD" variés, puis piste festive écartée par Christophe car hors ton de l'appli, puis pistes façon bulle de bande dessinée avec "?"/"!") ; design final retenu : bulle "BD" rouge avec petite bulle "?!" en accent dans le coin.
- Fonctionnalité ajoutée : loupe d'agrandissement sur chaque couverture (grille + fiche détail). Un petit bouton rond (icône loupe) en haut à droite de chaque couverture ouvre un aperçu plein écran (fond sombre, image agrandie, bouton fermer, clic hors-image ou touche Échap pour fermer). Dans la fiche détail, la loupe agrandit toujours la couverture du tome actuellement affiché (celle sur laquelle on a cliqué dans la liste des tomes). Choix assumé : réutilise les couvertures existantes (~500px de large, déjà stockées dans Supabase Storage) sans ré-extraction ni stockage de versions haute résolution — l'agrandissement se fait uniquement à l'affichage (CSS `max-width`/`max-height`), donc qualité limitée à la résolution source mais aucun coût de stockage/traitement supplémentaire.
- Fonctionnalité ajoutée : genre par titre (menu déroulant de filtre + tags affichés dans la fiche détail), liste fixe de 14 genres (voir section "Genres"). Classification des 852 titres en deux passes (connaissance générale, puis recherche web ciblée sur les titres incertains) — 806 titres avec au moins un genre, 46 sans genre faute de piste exploitable ; une partie des genres reste une estimation non vérifiée en ligne (quota de recherche web de la session atteint avant la fin), à corriger au fil de l'eau. Christophe a explicitement écarté le texte libre au profit d'une liste fixe extensible.
