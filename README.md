# Ma Bibliothèque BD

Catalogue personnel de bandes dessinées de Christophe (**1061 séries, 986 one-shots, 8407 albums**) : recherche par titre/auteur/genre, filtre séries / one-shots, marquage "lu" **par tome** (le titre passe "lu" automatiquement quand tous ses tomes le sont, filtrable en 3 états : Lus / En cours / Non lus) et favoris **par titre**, synchronisés entre iPhone, iPad et PC. Cliquer sur un tome dans la fiche détail affiche sa propre couverture. Site statique, sans backend applicatif — juste GitHub Pages + Supabase.

> **Version actuellement livrée : 2.4 du 24/10/2026**, affichée en bas de la page Réglages de l'appli. Règle et historique : section « Versions des livraisons ».
>
> **Mode d'emploi** : ce README est la documentation **technique** du projet. Le mode d'emploi **du propriétaire** est ailleurs : dans l'appli (Réglages → Aide, visible en mode propriétaire seulement) et en PDF (`Mode_emploi_proprietaire.pdf`). Voir la section « Aide et mode d'emploi ».
>
> **À faire vivre** : ce fichier doit être mis à jour à chaque changement fonctionnel, visuel ou technique. Il sert de mémoire au propriétaire du projet et de point de reprise rapide pour Claude/Codex lors d'une prochaine session.

## Vue d'ensemble de l'architecture

- **Site** : HTML/CSS/JS vanilla, aucun framework, aucune étape de build. Hébergé sur GitHub Pages.
- **Design** : 10 thèmes au choix (roue crantée → Réglages), voir la section « Thèmes et réglages ». Le thème par défaut reste la direction d'origine, "Kiosque BD" — style comic pulpe (police Bangers pour les titres, Archivo pour le reste, palette crème/rouge/noir, fond à trame demi-teinte dans le header). Les 3 directions écartées au départ ("Bibliothèque" épurée, "Atelier Noir" sombre, "Fiche d'Archive" catalogue) sont devenues des thèmes.
- **Données** : `data/catalog.json`, généré une fois par un pipeline de scripts Python (voir plus bas), à régénérer à chaque ajout/retrait de BD dans la collection source.
- **Couvertures** : hébergées sur **Supabase Storage** (pas dans le dépôt Git — trop de fichiers, voir section dédiée), **une par tome** (extraites automatiquement depuis la première page de chaque fichier PDF/cbz).
- **Synchro "lu"/"favoris"** : deux tables Postgres sur **Supabase** (`bd_volume_status` pour le "lu" par tome, `bd_status` pour les favoris par titre), lues/écrites en direct par le navigateur (clé publique "anon"), avec Realtime pour propager les changements entre appareils sans recharger la page. Pas d'authentification Supabase : l'accès aux statuts est filtré côté appli par le **mode propriétaire** (code), voir la section dédiée.
- **Corrections faites depuis l'appli** (titre, auteur, genres, libellé de tome, masquage, fusion de fiches, « pas un doublon ») : une troisième table, `bd_overrides`, appliquée **par-dessus** `catalog.json` au chargement. Le catalogue n'est jamais modifié par l'appli, et les corrections survivent donc aux réimports. Voir « Corriger et masquer depuis l'appli ».

## Structure des fichiers du site

```
ma-bibliotheque-bd/
├── index.html          # structure de la page (header recherche, grille, fiche détail)
├── themes.js           # registre des 10 thèmes (nom, polices, couleur de barre d'état) ;
│                        #   chargé AVANT style.css pour appliquer le thème sans flash
├── style.css           # toute la mise en forme, pilotée par des variables CSS ; un bloc
│                        #   [data-theme="…"] par thème ; responsive (grid auto-fill)
├── app.js              # toute la logique : chargement catalogue, recherche/filtres,
│                        #   rendu grille + fiche détail, lu par tome (calcul du "lu" titre),
│                        #   favoris par titre, aperçu couverture par tome, sync Supabase,
│                        #   corrections/masquages/fusions (bd_overrides) appliqués au
│                        #   chargement, écran « doublons probables » (propriétaire)
├── config.js            # identifiants Supabase (URL + clé anon — publics, sans risque)
│                        #   + BD_OWNER_HASH (empreinte du code propriétaire, pas le code)
│                        #   + BD_IMAGE_BASE (préfixe des couvertures sur Supabase Storage)
├── apple-touch-icon.png  # icône écran d'accueil iPad/iPhone (180×180, convention racine)
├── favicon.ico           # favicon multi-résolution (onglet navigateur)
├── site.webmanifest      # manifest PWA (icônes Android/Chrome, nom, couleurs)
├── icons/                 # déclinaisons de tailles de l'icône (apple-touch-icon-*, favicon-*,
│                        #   android-chrome-*) — voir section dédiée plus bas
├── Mode_emploi_proprietaire.pdf # mode d'emploi du propriétaire (même texte que Réglages → Aide),
│                        #   publié à la racine du site, lien dans Réglages → Aide
├── supabase_bd_overrides.sql # script du SQL Editor de Supabase : crée/complète la table
│                        #   bd_overrides (corrections depuis l'appli) — relançable,
│                        #   à relancer après chaque lot qui le modifie
├── masquages.json         # fiches masquées à l'import (doublons) — voir « Fiches masquées »
├── genre_map.json         # id -> {genres, confidence, source} — modifiable à la main,
│                        #   lu par build_public_catalog_v2.py (voir section "Genres")
├── genre_taxonomy.json    # liste fixe des genres, informatif (la vraie source pour l'appli
│                        #   est le tableau GENRES dans app.js)
├── data/
│   └── catalog.json     # catalogue généré (2047 entrées : 1061 séries + 986 one-shots)
├── pending_covers.json   # FICHIER DE TRAVAIL d'une mise à jour "delta" : liste des tomes
│                        #   dont la couverture reste à extraire (voir "Mise à jour du
│                        #   catalogue en mode delta"). Peut être supprimé une fois
│                        #   l'extraction terminée.
├── pending_oneshots.json # FICHIERS DE TRAVAIL de l'import des one-shots (oct. 2026) et
├── pending_missing.json  #   de la récupération des couvertures .cbr — supprimables
├── volume_covers_oneshots/ # les 1018 couvertures de l'import one-shots, à envoyer via
│                        #   uploader.html — GITIGNORÉ, supprimable une fois envoyé
├── volume_covers/        # copie locale des couvertures (une par TOME, ~8100 fichiers)
│                        #   — GITIGNORÉ, ne sert qu'à alimenter uploader.html
├── covers/               # ancien dossier (couverture par TITRE) — obsolète, gardé
│                        #   gitignoré, peut être supprimé
├── outils_delta/         # scripts de la mise à jour « delta » (voir « Mise à jour du
│                        #   catalogue en mode delta ») + leur état (etat/) — GITIGNORÉ,
│                        #   reste sur le PC
├── volume_covers_delta_<date>/ # couvertures d'un delta, à envoyer via uploader.html
│                        #   — GITIGNORÉ, supprimable une fois envoyé
├── uploader.html         # outil pour envoyer les couvertures vers Supabase Storage
│                        #   (sélectionner "volume_covers") — GITIGNORÉ, jamais publié
└── .gitignore            # exclut covers/, volume_covers*/, uploader.html et les
                         #   fichiers de travail (pending_*.json, _*.json, _to_delete/)
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
  "genre": ["Fantasy", "Aventure"], // 0 à 2 valeurs, tirées de la liste fixe — voir section "Genres"
  "one_shot": true                  // PRÉSENT UNIQUEMENT sur les one-shots (absent = série)
}
```

Un **one-shot** est une entrée ordinaire avec un seul tome, dont le libellé est le titre de l'album, et `one_shot: true`. Il passe donc par exactement le même code que les séries : coche « lu » sur son unique tome (clé Supabase `"<id>::0"`), favoris, genre, recherche. Aucune table ni colonne Supabase n'a été ajoutée pour eux.

`cover` (au niveau tome ou titre) peut être `null` si l'extraction a échoué pour ce fichier (ex : `.cbr`, PDF corrompu) — l'appli affiche alors une case vide à la place de l'image.

## Backend Supabase

- Projet : `ma-bibliotheque-bd` (org `deepblue67`), ref `aotudxyifqhyazluxhko`, région `eu-west-1` (Irlande).
- Project URL : `https://aotudxyifqhyazluxhko.supabase.co`
- La clé **anon** (publique, dans `config.js`) est protégée par les policies RLS ci-dessous — elle ne donne accès qu'aux tables `bd_status` / `bd_volume_status` / `bd_overrides` et à la lecture du bucket `covers`.
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

### Table `bd_overrides` (corrections et masquages faits depuis l'appli)

Script complet, commenté et relançable sans risque : `supabase_bd_overrides.sql` (à coller dans Supabase → SQL Editor → New query → Run).

```sql
create table if not exists public.bd_overrides (
  id          text primary key,   -- id de fiche ("Thorgal") ou de tome ("Thorgal::2", index d'origine)
  hidden      boolean,            -- true = masqué, false = démasqué exprès, null = valeur du catalogue
  title       text,               -- titre de fiche ou libellé de tome (null = celui du catalogue)
  author      text,               -- fiches seulement
  genre       text[],             -- fiches seulement, 0 à 2 genres de la liste fixe
  merged_into text,               -- fiches seulement : id de la fiche qui l'absorbe (fusion)
  not_dup     boolean,            -- lignes "nodup:<clé1>|<clé2>" : « pas un doublon »
  updated_at  timestamptz not null default now()
);
-- + "alter table … add column if not exists" pour les colonnes ajoutées après coup
-- RLS : lecture, insertion, modification et suppression publiques (comme les deux autres tables)
-- + ajout à la publication supabase_realtime
```

Les colonnes `merged_into` et `not_dup` ont été ajoutées au lot « fusion et doublons probables ». L'appli ne les envoie que lorsqu'elles servent : tant que le script n'a pas été relancé, les corrections simples continuent de marcher, et seules la fusion et « pas un doublon » échouent avec un message qui demande de relancer le script.

Une ligne n'existe que tant qu'il reste quelque chose à corriger : quand tous les champs reviennent à « valeur du catalogue », l'appli **supprime** la ligne (d'où la policy `delete`, que les deux autres tables n'ont pas).

Contrairement aux statuts, cette table est lue **par tout le monde**, visiteurs compris : un visiteur doit voir les titres corrigés et ne pas voir les fiches masquées. Elle n'est **écrite** qu'en mode propriétaire, avec la même limite que pour les statuts : le garde-fou est dans l'interface, pas dans la base (voir « Mode propriétaire »).

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

Depuis la version 2.0, **un seul numéro** : la version de l'appli (`APP_VERSION` dans `app.js`). `index.html` charge `themes.js`, `style.css`, `config.js` et `app.js` avec ce même suffixe (`?v=2.0`). À chaque livraison, le numéro change partout à la fois, ce qui oblige les navigateurs, Safari iPhone compris, à reprendre les nouveaux fichiers plutôt que leur copie en cache (vécu : un `app.js` mis à jour restait invisible malgré plusieurs rechargements, jusqu'à un vidage de cache complet). Règle détaillée : section « Versions des livraisons ». `data/catalog.json` n'a pas ce problème : il est chargé via `fetch(..., { cache: "no-store" })` dans `app.js`, donc toujours à jour sans rien à incrémenter, et **une livraison qui ne touche que les données** (catalogue, couvertures, scripts SQL) **ne change pas le numéro**.

Avant la 2.0, chaque fichier avait son propre compteur (`app.js?v=13`, `style.css?v=13`, `config.js?v=4`, `themes.js?v=1`) : ces anciens numéros apparaissent encore dans l'historique.

## Pipeline de génération des données

Les BD sources vivent dans `D:\Christophe\Mes BD` (dossier = un titre, fichiers PDF/cbz/cbr = les tomes). Le dossier du site, lui, est `D:\Christophe\IA\IA - Claude\ma-bibliotheque-bd` (il a été déplacé sous `IA\` en octobre 2026 — si un script du pipeline parle encore de `~/mnt/Christophe/IA - Claude/...`, c'est l'ancien chemin, à corriger en `~/mnt/Christophe/IA/IA - Claude/...`). Les scripts qui construisent `catalog.json` et les couvertures tournent **sur l'ordinateur de Christophe**, via des scripts Python situés dans `~/bd-catalog/` **côté VM Linux locale** (accessible uniquement par l'outil `device_bash` d'une session Claude liée à cet ordinateur — ce n'est PAS un dossier Windows classique, donc invisible dans l'Explorateur).

⚠️ **Dépendance fragile à connaître** : ces scripts n'accèdent aux fichiers de Christophe que par les dossiers *montés* dans cette VM (`~/mnt/Mes BD`, `~/mnt/Christophe`). En octobre 2026, après la mise à jour de l'appli Claude du PC (v1.46 → v2.37), **ces montages ont cessé de fonctionner** : `~/mnt/*` est resté vide alors que les dossiers étaient bien connectés. Les outils `device_list_dir` / `device_stage_files` / `device_commit_files` continuaient, eux, de voir les fichiers par leur chemin Windows. Conséquence pratique : on peut toujours **inventorier** la collection et **livrer** des fichiers, mais plus **extraire les couvertures** (qui exige de lire des PDF de ~90 Mo en local — impossible à faire transiter). Si `ls ~/mnt/"Mes BD"` renvoie 0 entrée, le réflexe est de demander à Christophe de quitter et relancer complètement l'appli Claude sur son PC, puis de déconnecter/reconnecter `D:\Christophe` dans les réglages.

Étapes (dans l'ordre, chaque script lit la sortie du précédent) :

1. **`scan.py`** (ou `scan_delta.py` pour un delta) — parcourt `Mes BD`, exclut `1 2 3 A CLASSER`, `1 2 3 A TRIER`, `BD Unique` (traité à part en one-shots), `BD Serie à completer` (dossiers non finalisés, ignorés) et tout dossier `Nouveau dossier*`. Pour chaque dossier-titre, liste les fichiers volumes directs + les sous-dossiers contenant eux-mêmes des volumes (sous-séries potentielles). → `scan.json`
2. **`extract_covers.py`** — extrait la 1ère page du 1er tome de chaque titre comme couverture JPEG (PyMuPDF pour PDF, zipfile+Pillow pour cbz). Les `.cbr` échouent (pas d'`unrar` disponible sur la VM) — géré au cas par cas. Tourne par lots de ~150s (la VM locale n'autorise pas de process en arrière-plan persistant entre deux appels `device_bash`). → `covers_manifest.json`, `covers/*.jpg`
3. **`extract_meta.py`** — lit le champ `Author` des métadonnées PDF de chaque 1er tome (rapide, pas de rendu de page). → `meta_manifest.json`
4. Classification heuristique (`looks_plausible`) pour ne garder que les auteurs PDF qui ressemblent à de vrais noms (filtre les tags de scan type "CDS", noms de sites, etc.) → `authors_from_metadata.json` (761/819 résolus automatiquement au premier passage).
5. Pour les titres restants sans auteur fiable, un **agent de recherche web** (bedetheque.com / bdgest.com) a été lancé une fois pour vérifier ~45 titres ambigus. Résultat codé en dur dans `assemble_catalog.py` (`AGENT_AUTHORS`, `NOT_FOUND`). Une poignée d'auteurs de franchises très connues ont été ajoutés à la main (`KNOWN_AUTHORS`).
6. **`assemble_catalog.py`** — le script pivot :
   - applique la logique d'auteur (`author_for()`) dans l'ordre : métadonnées PDF > connaissance générale > recherche agent > "non trouvé" ;
   - applique ~22 règles manuelles (dict `SPECIAL`) pour séparer les **vrais spin-offs** en entrées de catalogue distinctes (ex: `Donjon` → 6 cycles séparés, `Alix` → + Alix Senator/raconte/Origine/Odyssée, `Lucky Luke` → + Kid Lucky/HS/Vu par...) tout en **ignorant les doublons de scan** (ex: dossiers alternatifs de Tintin, double jeu PDF d'Astérix, compilations dupliquées de XIII) ;
   - → `final_catalog.json` (852 entrées finales, 845 avec auteur).
7. **`fix_ascii_covers.py`** — (historique) renomme en ASCII tout nom de couverture par TITRE qui en contenait — n'est plus utilisé depuis le passage aux couvertures par tome (l'étape 8 ci-dessous produit directement des noms ASCII).
8. **`extract_volume_covers.py`** — extrait une couverture JPEG pour **chaque tome** de chaque titre (pas seulement le 1er), avec un nom de fichier ASCII généré directement (`<prefixe_titre_ascii>_<NNN>.jpg`, préfixe dédupliqué stocké dans `volume_prefix_map.json`). Même logique PyMuPDF/zipfile+Pillow que `extract_covers.py`, même contrainte `.cbr` non supporté, même fonctionnement par lots resumable (`volume_covers_manifest.json` comme checkpoint, appelé en boucle avec un budget de ~150s). → `volume_covers/*.jpg` (~7082 fichiers sur 7130 tomes ; le reste = `.cbr` ou fichiers illisibles, `cover: null` dans le catalogue).
9. **`build_public_catalog_v2.py`** — nettoie les noms de tomes affichés (retire le préfixe `<Série>_Tome_NN_`) et associe à chaque tome sa couverture individuelle (`volume_covers_manifest.json`) → `catalog_public_v2.json`, copié vers `data/catalog.json` du site. `volumes` y est un tableau d'objets `{label, cover}` (voir schéma plus haut) au lieu d'un simple tableau de libellés. Depuis l'ajout du genre, ce même script lit aussi `genre_map.json` (voir section "Genres" ci-dessous) et ajoute le champ `genre` à chaque entrée.

**Pour ajouter de nouvelles BD à l'avenir** : relancer le pipeline à partir de `scan.py` (le plus fiable), puis `extract_volume_covers.py` et `build_public_catalog_v2.py`. Envoyer les nouveaux fichiers de `volume_covers/` sur le bucket Supabase `covers` via `uploader.html` (`upsert:true`, donc rejouer l'envoi complet ne casse rien). Penser aussi à classifier le genre des nouveaux titres dans `genre_map.json` (sinon ils sortent avec `"genre": []`, donc invisibles au filtre genre) — le plus simple est de demander à Claude de le faire lors de la session qui traite l'ajout. Rien d'autre à changer : `app.js` lit `data/catalog.json` dynamiquement.

### Mise à jour du catalogue en mode « delta » (sans remonter tout le pipeline)

**Depuis le 27 octobre 2026, la méthode est rangée dans `outils_delta/`** (dossier du site, gitignoré) : six scripts numérotés que Claude lance sur la VM, sans transférer de fichiers vers le cloud. Christophe n'a qu'à dire à Claude « fais le delta BD ». Le mode d'emploi des scripts est dans `outils_delta/LISEZMOI.md` :

1. `1_scan.py` : inventaire de Mes BD et des fichiers nouveaux de `BD Unique` ;
2. `2_analyse.py` : rapport des nouveautés, sans rien écrire ;
3. `3_meta.py 150` : auteurs lus dans les PDF et gabarit `etat/a_completer.json` ;
4. Claude choisit les genres (deux au plus, liste fermée) et vérifie titres et auteurs des one-shots dans `etat/research.json` ;
5. `4_fusion.py` : fusion *append-only* dans `etat/build/` ;
6. `5_couvertures.py 95` : couvertures PDF, CBZ ou CBR, à relancer jusqu'à « reste 0 » ;
7. `6_finir.py` : contrôles et planche contact des couvertures ; puis `6_finir.py --installer`, qui sauvegarde l'ancien catalogue dans `etat/sauvegardes/<date>/`, installe le nouveau et copie les couvertures dans `volume_covers_delta_<date>/`.

`etat/oneshots_importes.json` liste les fichiers de `BD Unique` déjà traités, importés ou écartés : ce sont eux qui ne reviendront pas comme nouveautés. Les explications qui suivent décrivent les règles que ces scripts appliquent.

La mise à jour d'octobre 2026 a dû se faire autrement, parce que les montages `~/mnt/*` étaient cassés (voir l'avertissement ci-dessus) : impossible de lancer `scan.py`. La méthode retenue est plus sûre que de tout régénérer et vaut d'être réutilisée, même quand le pipeline complet fonctionne, car **elle ne touche jamais aux tomes déjà catalogués** :

1. **Inventaire** via `device_list_dir` (un appel par dossier-titre), parallélisé sur des agents pour ne pas saturer une seule session. On compare le nombre d'albums de chaque dossier au `volume_count` du catalogue : les dossiers absents du catalogue sont des nouveautés, ceux dont le compte diffère ont gagné des tomes, les autres sont ignorés.
2. **Rapprochement des tomes** d'une série modifiée par *consommation ordonnée* des libellés : chaque fichier réclame le premier tome encore non apparié portant le même libellé (comparaison en NFC, espaces normalisés, insensible à la casse). Ce détail compte : un simple `in` sur un ensemble de libellés se trompe dès qu'une série contient deux libellés identiques ou vides (cas réel : `Vikings_dans_la_brume_Tome_01.pdf` et `..._Tome_03.pdf` produisent tous deux un libellé vide).

   ⚠️ **Et surtout : un fichier doit être comparé sous TOUTES les formes sous lesquelles il a pu être libellé**, sinon on croit à tort qu'un tome est nouveau et on le duplique. Les quatre formes à essayer sont : le libellé nettoyé par la règle actuelle, celui produit par l'ancienne règle (qui laissait une chaîne vide quand le fichier n'avait pas de sous-titre), la version sans accents, et **le nom de fichier brut non nettoyé** — car quand le retrait du préfixe de série échouait (nom de fichier sans accents, ou encodé différemment du titre), l'ancien script stockait le nom de fichier entier comme libellé. Cas vécu, qui a produit un faux doublon avant d'être corrigé : dans la série « Le Réseau Papillon », le fichier du tome 07 s'appelle `Le_Reseau_Papillon_...` (sans accent) et celui du tome 06 est encodé en NFD. Le garde-fou à garder : **le nombre de tomes d'une série simple doit toujours être égal au nombre de fichiers album de son dossier** — c'est ce contrôle qui a révélé le doublon.
3. **Insertion à la bonne place, mais seulement après avoir vérifié les coches de lecture.** Le statut « lu » d'un tome est stocké dans Supabase sous la clé `"<titleId>::<index>"` : **l'index est la clé**, donc insérer un tome au milieu d'une série décale tous les suivants et déplace les coches de lecture de Christophe. La liste des tomes est reconstruite dans l'ordre des fichiers du disque (c'est la convention de tout le catalogue, héritée du scan initial), mais **avant toute remise en ordre il faut interroger `bd_volume_status` pour savoir quelles séries ont des tomes cochés**. Trois cas :
   - la série n'a aucun tome coché → on réordonne librement, il n'y a rien à migrer ;
   - la série a des tomes cochés **et** son ordre ne change pas → rien à faire non plus ;
   - la série a des tomes cochés **et** son ordre change → il faut migrer les lignes `bd_volume_status` (recalculer `is_read` pour chaque index), et cela ne se fait **qu'avec l'accord explicite de Christophe**, puisque ça écrit dans ses données.

   **Même règle pour `bd_overrides`** (depuis octobre 2026) : les lignes de **tome** (`"<titleId>::<index>"`, libellé corrigé ou tome masqué) sont, elles aussi, rattachées à l'index, de même que les décisions « pas un doublon » portant sur des tomes (`"nodup:<clé>|<clé>"`). Avant de réordonner une série, il faut donc lister aussi les lignes `bd_overrides` dont l'id contient `::` pour cette série et, si l'ordre change, les déplacer avec le même accord. Les lignes de **fiche** (id sans `::`) ne dépendent que de l'id de la fiche ; elles ne sont concernées que si une fiche change d'id (renommage du dossier) : la ligne serait alors orpheline et la correction à refaire, ou la ligne à renommer. Même chose pour une **fusion** (`merged_into` pointe vers l'id de la fiche d'accueil) : si la fiche d'accueil disparaît du catalogue, la fiche fusionnée réapparaît simplement toute seule, rien n'est perdu.

   En octobre 2026, seules 3 séries avaient des tomes cochés (*Alter Ego*, *Lloyd Singer - Makabi*, *Louise Beauvoir*) et aucune n'était concernée par le tri : aucune migration n'a été nécessaire. Note pratique : le conteneur cloud et la VM locale n'ont **pas** d'accès réseau à `*.supabase.co` ; pour interroger la base il faut exécuter le `fetch` depuis la page du site elle-même, via le navigateur (outil `Claude_Browser__javascript_tool`), où la clé anon est déjà chargée.

   Les numéros des fichiers de couverture (`_001`, `_002`…) ne suivent plus forcément la position du tome après un tri : c'est sans conséquence, le nom du fichier n'est qu'une clé de stockage et chaque couple (tome, couverture) se déplace d'un bloc. Ce qui doit rester vrai, et qui est contrôlé, c'est que les couvertures **d'origine** restent en ordre numérique croissant au sein d'une série.
4. **Couvertures** : le merge écrit `cover: null` pour chaque tome ajouté et liste ces tomes dans `pending_covers.json` (id, titre, chemin relatif sous « Mes BD », nom de fichier source, index, nom ASCII de sortie déjà dédupliqué et sans collision avec ce qui est déjà sur Supabase Storage). `extract_new_covers.py` (côté VM, `~/bd-catalog/`) consomme ce fichier par lots de ~150 s avec `new_covers_manifest.json` comme point de reprise — même principe resumable que `extract_volume_covers.py`.
5. **Contrôle** avant livraison : aucun `id` perdu ni dupliqué, aucun index de tome existant décalé, aucune couverture existante modifiée, genres pris dans la liste fermée, noms de couvertures uniques/ASCII/sans collision.

## Genres

Chaque titre a 0 à 2 genres (`catalog.json` → champ `genre`, tableau), tirés d'une **liste fixe** (pas de texte libre) — actuellement :

`Aventure, Biographie, Documentaire, Drame / Chronique sociale, Fantastique / Horreur, Fantasy, Guerre, Historique, Humour, Jeunesse, Policier / Thriller, Science-fiction, Super-héros, Western`

Cette liste vit à deux endroits qui doivent rester synchronisés : `genre_taxonomy.json` (à la racine du dossier du site, purement informatif) et le tableau `GENRES` en haut de `app.js` (qui peuple réellement le menu déroulant de filtre). **Pour ajouter un genre à la liste** : l'ajouter aux deux, puis reclassifier les titres concernés dans `genre_map.json`.

**Comment la classification initiale a été faite** (852 titres, aucune info de genre dans les métadonnées des fichiers — les 150 titres ajoutés en octobre 2026 ont été classés de la même façon, voir l'historique) :
1. **Passe 1 — connaissance générale** : le catalogue a été réparti en lots, chacun classifié par un agent à partir de sa connaissance des séries BD, avec un niveau de confiance ("high" seulement si la série est vraiment reconnue). 342 titres résolus avec confiance.
2. **Passe 2 — recherche web ciblée** : pour les ~510 titres restants (peu/pas connus, souvent avec `author: null`), des agents ont cherché chaque titre sur bedetheque.com, bdgest.com, Wikipedia, etc. Le quota de recherche web de la session a été atteint avant la fin (partagé entre tous les agents en parallèle) : 174 titres ont pu être vérifiés en ligne ; pour le reste, l'estimation de la passe 1 a été conservée telle quelle (non vérifiée) ; 46 titres restent sans genre du tout (aucune piste trouvable — souvent des titres génériques ou très confidentiels).

Résultat : `genre_map.json` (id → `{genres, confidence, source}`) — `confidence: "low"` signale un genre à prendre avec réserve. Contrairement aux autres manifestes du pipeline (qui restent sur la VM Linux locale, invisibles depuis Windows), **`genre_map.json` et `genre_taxonomy.json` sont placés directement à la racine du dossier `ma-bibliotheque-bd`**, donc visibles et modifiables dans l'Explorateur — c'est fait exprès, puisque c'est le seul fichier du pipeline pensé pour être corrigé à la main. Si tu repères une erreur en parcourant l'appli, le plus simple reste de me le signaler, mais tu peux aussi éditer directement la ligne correspondante dans `genre_map.json` toi-même — il suffit ensuite de redemander à Claude de relancer `build_public_catalog_v2.py` (script resté côté VM) pour régénérer `data/catalog.json`. Ces deux fichiers ne sont pas gitignorés : ils partent avec le reste du dépôt lors du push (ce sont de petits fichiers texte, sans problème de volume comme les couvertures).

## Recherche

Le champ « titre » cherche dans le nom de la série **et dans le titre de tous ses tomes** : « magicienne trahie » trouve *Thorgal*. Les deux champs, titre et auteur, suivent les mêmes règles (fonction `normalize()` dans `app.js`) :
- les **accents** sont ignorés (« etrange » → *Étrange*), tout comme `œ`/`æ` (« oeil » → *Œil de dragon*) ;
- les apostrophes droites et courbes sont confondues, puis supprimées (« l'arabe » → *L’Arabe du futur*) ;
- toute **ponctuation** compte comme un espace (« kim jong un » → *Kim Jong-un*, « jean marc » → *Jean-Marc*) ;
- **plusieurs mots** peuvent être tapés **dans n'importe quel ordre** : tous doivent être présents (« terre pilliers » → *Les pilliers de la terre*).

**La recherche ne porte que sur ce qui est affiché** (version 2.4) : le titre de la fiche (corrigé s'il l'a été), les titres de ses tomes visibles (corrigés s'ils l'ont été ; un tome masqué ne répond plus) et l'auteur affiché. Un titre d'origine remplacé par une correction ne répond plus. Seule exception : les fiches **fusionnées** dans une autre n'ont plus de vignette, donc leur nom, tel qu'affiché dans la ligne « Fiche fusionnée ici », mène à la fiche qui les a absorbées. Code : `buildSearchIndex()` ; vérifié par `test9_search.js` (19 vérifications, dont le cas réel *Louise Beauvoir_CDS_* → *Louise Beauvoir*).

L'index de recherche est calculé une seule fois, au chargement du catalogue. La grille n'est reconstruite que 150 ms après la dernière frappe. Ce qu'on ne rattrape pas, ce sont les fautes de frappe dans les noms de fichiers : « piliers » ne trouve pas « pilliers ». C'est le rôle de la future fonction « corriger le titre ».

## Chargement des vignettes (couvertures de la grille)

Avec ~2000 vignettes, tout charger à l'ouverture représenterait ~140 Mo : les couvertures de la grille sont donc chargées **à la demande**, quand la vignette approche de l'écran (marge de 800 px). L'image de la fiche détail, elle, est chargée directement. Depuis la version 2.3, ce chargement est **auto-réparant**, après le signalement par Christophe de vignettes vides (*Jason et la Toison d'Or*, *J'ai arrêté Otto Abetz*, *Je suis au-delà de la mort!*…) alors que leurs couvertures s'affichaient dans la fiche et répondaient bien sur Supabase :

1. un `IntersectionObserver` demande l'image quand la vignette approche de l'écran ;
2. un **filet de sécurité** (`sweepVisible()`), lancé après chaque défilement, saut de lettre, retour à la grille ou nouvel affichage, demande toute vignette proche de l'écran restée en attente. Certains navigateurs, Safari notamment, peuvent rater une notification de l'observateur après un défilement rapide ;
3. une image **en échec** est retentée deux fois, après 1,5 s puis 5 s (`RETRY_DELAYS`), avec `?r=1` puis `?r=2` ajouté à l'adresse pour ne pas retomber sur un échec gardé en cache. Après le dernier échec, la vignette montre son fond (classe `img-failed`) plutôt qu'une icône d'image cassée.

Avant la 2.3, une image en échec n'était jamais redemandée, et une vignette « ratée » par l'observateur ne l'était jamais non plus : elle restait vide jusqu'au rechargement de la page. La cause exacte n'a pas pu être reproduite (ni sur PC, ni à la taille d'un iPhone, avec le même code), d'où ces protections, qui couvrent les deux mécanismes possibles. Suite de tests `test8_lazy.js` (16 vérifications : échecs passagers réparés à l'ouverture et après des sauts de lettre, observateur muet compensé par le filet à l'ouverture, après un saut, un défilement, un retour des Réglages, une recherche et la croix, filet limité aux vignettes proches de l'écran, image définitivement absente : 3 tentatives puis fond de vignette, les autres vignettes intactes). Passée sur la version 2.2, cette suite échoue sur 12 des 16 vérifications, ce qui confirme qu'elle détecte bien le défaut.

## Barre alphabétique

Reprise de l'appli ebooks (son « index A–Z collant », §4 de son README). Juste au-dessus de la grille, une barre `# A B … Z` **reste accrochée en haut de l'écran** pendant le défilement. Un clic (ou un tap) sur une lettre fait défiler jusqu'au premier titre qui commence par elle. `#` regroupe les titres qui commencent par un chiffre ou un signe, comme *(Dé)rangée*, *1984* ou *13h17…*. Les lettres sans aucune BD sont grisées et inactives. Dans la grille, un **séparateur de lettre** (grande lettre et filet) précède chaque groupe.

- **Lettre de classement** : première lettre du titre affiché, sans accent (*Élya* → E, *À la recherche…* → A), avec *Œ* → O et *Æ* → A. Elle suit exactement l'ordre de tri de la grille (`localeCompare` en français), y compris les articles : *Les légendaires* est sous L. La suite `test7_az.js` vérifie, sur le vrai catalogue, que chaque fiche se trouve sous le bon séparateur et que les séparateurs sont dans l'ordre.
- **Saut sans changer l'adresse** : le défilement se fait par `window.scrollTo`, en s'arrêtant juste sous la barre pour que le séparateur reste visible. L'historique n'est pas touché : le bouton retour garde son rôle.
- **Suit les filtres** : la barre et les séparateurs sont recalculés sur les fiches affichées (One-shots, un genre, Lus…). En dessous de 40 résultats (`AZ_MIN`, typiquement une recherche précise), ils disparaissent : ils n'apporteraient rien.
- **Téléphone** : deux rangées de 14 cases, d'environ 23 × 34 px, avec une barre de moins de 85 px de haut au total.
- **Piège corrigé au passage** : `html, body { overflow-x: hidden }` empêchait tout élément collant. Sur `<body>`, `hidden` en fait une zone de défilement à part, alors que c'est la fenêtre qui défile. Désormais `html` garde `overflow-x: hidden` (pas de défilement horizontal) et `body` passe en `overflow-x: clip`, qui coupe ce qui dépasse sans créer de zone de défilement. À ne pas remettre.

Code : `initialOf()`, `letterHead()`, `renderAz()`, `jumpToLetter()` et `renderGrid()` dans `app.js` ; styles `.az` et `.letter-head` dans `style.css`.

## Thèmes et réglages

La roue crantée, en haut à droite, ouvre la **page Réglages** (adresse `#/reglages`). C'est une vraie page, plus une fenêtre par-dessus la grille, sur le modèle de l'appli ebooks de Christophe : « ← Retour à la bibliothèque » en haut (le bouton retour du téléphone marche aussi), recherche et filtres masqués tant qu'on n'est pas sur la grille, et on retrouve la grille à l'endroit où on l'avait quittée. La page contient le choix du thème, le **mode propriétaire** (section suivante) et, en mode propriétaire, *Doublons probables*, *Fiches masquées et fusionnées* et l'*Aide*. *Doublons probables* ouvre à son tour une page (`#/doublons`, « ← Retour aux réglages » ; un visiteur qui tape cette adresse est renvoyé aux Réglages).

**Sections pliables.** Chaque section se plie et se déplie d'un clic sur son titre (chevron à droite, cible tactile de 44 px), et « Tout déplier · Tout replier » en haut agit sur toutes. Ce qui est replié est **mémorisé sur l'appareil** (`localStorage`, clé `bd_reglages_replies_v1`) : la page se rouvre telle qu'on l'a laissée, y compris après un changement de thème ou un déverrouillage. Tout est déplié au premier affichage. Code : `setBlockOpen()` et le câblage qui suit dans `app.js` ; routage : `route()` (événement `hashchange`).

**Numéro de version.** Tout en bas de la page, visible par tous : « Ma Bibliothèque BD — version 2.0 du 24/10/2026 ». Il permet de vérifier d'un coup d'œil qu'un appareil affiche bien la dernière publication.

Les 10 thèmes : *Kiosque BD* (défaut, l'original), *Atelier noir*, *Bibliothèque*, *Fiche d'archive*, *Ligne claire*, *Manga*, *Comics US*, *Western*, *Néon SF*, *Pastel jeunesse*.

Fonctionnement :
- `style.css` ne contient plus aucune couleur en dur. Tout passe par une quarantaine de variables (`--bg`, `--accent`, `--line`, `--bw-l`, `--sh-card`, `--font-display`…) définies dans `:root` pour le thème par défaut, puis redéfinies dans un bloc `[data-theme="…"]` par thème. Un thème change aussi les épaisseurs de trait, les ombres, les arrondis et les polices, pas seulement les couleurs. **Pour ajouter un thème** : un bloc dans `style.css` et une ligne dans `themes.js`.
- Ces blocs s'appliquent à **n'importe quel élément** portant `data-theme`, et pas seulement à `<html>`. C'est ce qui permet à chaque carte d'aperçu des Réglages de se dessiner dans son propre thème, sans code spécifique.
- `themes.js` est chargé de façon **bloquante, avant `style.css`**. Il pose le thème mémorisé sur `<html>` et charge ses deux polices Google Fonts avant le premier affichage, ce qui évite de voir défiler le thème par défaut au démarrage. Seules les polices du thème actif sont chargées ; les autres ne sont chargées qu'à l'ouverture des Réglages, pour les aperçus. Il met aussi à jour la couleur de la barre d'état (`meta theme-color`) sur iPhone et Android.
- Le choix est mémorisé **par appareil** (`localStorage`, clé `bd_theme_v1`), sans synchronisation Supabase : ton iPhone et ton PC peuvent avoir chacun le leur. Il suffirait d'une colonne dans Supabase pour synchroniser le thème si on le voulait un jour.
- Toutes les polices retenues contiennent les caractères français (vérifié glyphe par glyphe : É, È, Ç, Œ, œ, ’, « »…).
- Le zoom plein écran sur une couverture garde volontairement un fond noir quel que soit le thème.

## Mode propriétaire

Choix validé avec Christophe : la protection est un **code**. C'est un garde-fou contre les fausses manipulations, pas une serrure, et il en a été informé.

**Ce que voit chacun.** Sur un appareil en **mode visiteur** (par défaut), l'appli montre la bibliothèque et rien d'autre : pas de pastilles Lu / En cours / ★, pas de puces Lus / En cours / Non lus / Favoris, pas de cases à cocher sur les tomes, pas de boutons « marquer comme lu » / favoris. Les statuts ne sont même **pas téléchargés** depuis Supabase, et le cache local n'est pas lu. (Seule la table des corrections, `bd_overrides`, est lue par les visiteurs, pour qu'ils voient les titres corrigés et pas les fiches masquées.) Le propriétaire peut en plus corriger et masquer des fiches et des tomes, voir « Corriger et masquer depuis l'appli ». Sur un appareil en **mode propriétaire**, tout réapparaît et la synchro Supabase fonctionne comme avant. Mécanique : une classe `is-owner` sur `<html>` ; tout élément marqué `owner-only` est masqué sans elle, et `app.js` teste `IS_OWNER` avant chaque affichage de statut.

**Comment c'est vérifié.** Le code n'est enregistré nulle part. `config.js` contient `window.BD_OWNER_HASH`, une empreinte **PBKDF2-SHA-256** (200 000 itérations, sel fixe `ma-bibliotheque-bd/owner/v1`) calculée dans le navigateur avec `crypto.subtle`, qui exige une page en https. À la saisie du bon code, l'appareil garde cette même empreinte dans son `localStorage` (clé `bd_owner_v1`) et reste déverrouillé. « Quitter le mode propriétaire » l'efface. Si l'empreinte de `config.js` change (changement de code), **tous** les appareils repassent automatiquement en visiteur.

**Limite assumée.** Les règles Supabase (RLS) acceptent toujours les écritures avec la clé publique, et la clé anon permet aussi de lire les statuts. Quelqu'un qui lit le code source peut donc lire ou écrire les statuts directement dans la base. Pour un vrai verrou, il faudrait l'authentification Supabase (lien magique par e-mail) et des règles RLS réservées au compte de Christophe. Cette option (b) a été écartée pour l'instant.

**Mise en service (deux publications) :**
1. Publier l'appli avec `BD_OWNER_HASH = ""` : elle est alors en lecture seule pour **tout le monde**, Christophe compris. C'est voulu : mieux vaut un défaut fermé.
2. Sur le site : Réglages → Mode propriétaire → saisir deux fois le code (6 caractères minimum) → « Générer l'empreinte » → copier la ligne `window.BD_OWNER_HASH = "…";` affichée.
3. La recopier dans `config.js` **et incrémenter `config.js?v=` dans `index.html`** (sinon des appareils peuvent garder l'ancien `config.js` en cache), puis publier. Plus simple : envoyer la ligne à Claude, qui fait les deux. L'empreinte n'est pas un secret, puisqu'elle est de toute façon publique dans `config.js` sur GitHub.
4. Sur chaque appareil : Réglages → saisir le code → « Déverrouiller ».

**Variante sans double publication** : calculer l'empreinte **sur le PC**, avant la première publication, avec la commande PowerShell ci-dessous (Windows 10/11, sans rien installer). Le code est demandé de façon masquée, n'est pas affiché et ne reste pas dans l'historique. Il ne faut **jamais** taper son code dans un site « calculateur de hash » en ligne. Copier ensuite la ligne affichée dans `config.js` (ou l'envoyer à Claude), puis publier une seule fois.

```powershell
$c = Read-Host "Code propriétaire" -AsSecureString; $p = [Runtime.InteropServices.Marshal]::PtrToStringBSTR([Runtime.InteropServices.Marshal]::SecureStringToBSTR($c)); $k = New-Object Security.Cryptography.Rfc2898DeriveBytes(([Text.Encoding]::UTF8.GetBytes($p)), ([Text.Encoding]::UTF8.GetBytes('ma-bibliotheque-bd/owner/v1')), 200000, ([Security.Cryptography.HashAlgorithmName]::SHA256)); 'window.BD_OWNER_HASH = "' + (($k.GetBytes(32) | ForEach-Object { $_.ToString('x2') }) -join '') + '";'
```

Résultat vérifié identique à l'appli, y compris avec des accents dans le code. Équivalent en Python : `hashlib.pbkdf2_hmac('sha256', code.encode(), b'ma-bibliotheque-bd/owner/v1', 200000).hex()`.

**Pourquoi PBKDF2 et pas un simple SHA-256 de `préfixe:code`** (méthode utilisée sur l'autre appli de Christophe) : l'empreinte est publique, puisqu'elle est dans `config.js` sur GitHub. Avec un SHA-256 simple, un code de 6 à 8 caractères se retrouve par force brute en quelques minutes ; PBKDF2 à 200 000 itérations rend chaque essai 200 000 fois plus coûteux. L'enjeu n'est pas l'appli elle-même, puisque le mode propriétaire n'est qu'un garde-fou, mais le code : on réutilise souvent un même code ailleurs. La contrepartie est qu'un calculateur SHA-256 « ordinaire » ne suffit plus, d'où la commande PowerShell.

**Changer de code** : en mode propriétaire, « Changer de code… » génère une nouvelle ligne, à publier de la même façon. **Code oublié** : générer une nouvelle empreinte depuis n'importe quel appareil et la publier. Le générateur n'a besoin d'aucun droit, puisque c'est la publication sur GitHub qui fait foi.

## Fiches masquées (`masquages.json`)

Une fiche **masquée** reste dans `data/catalog.json`, avec `"hidden": true` et une `hidden_reason`, mais l'appli ne l'affiche ni ne la compte jamais. C'est voulu : le prochain import la retrouve, la reconnaît et ne la réinsère pas. `masquages.json` est la liste de référence (id → fiche qui la remplace, raison, date) : tout import doit la réappliquer. **Pour démasquer** une fiche, la retirer de `masquages.json` et régénérer le catalogue.

Premier usage (octobre 2026) : les **7 séries en double** créées par l'import d'octobre, qui avait ajouté les nouveaux dossiers d'une série au lieu de remplacer les anciens. Dans chaque cas, le dossier gardé contient **tous** les fichiers de l'ancien (vérifié fichier par fichier) plus un tome : *Arctica (13-13)*, *Les Foot furieux* (gardé : *MANQUE LE 28*, qui a le tome 29), *Léo Loden (29-29…)*, *Léonard (30-56…)*, *Seuls (15-15)*, *Travis (16-17)*. S'y ajoute *Légendes de la table ronde bis*, copie identique. Aucune de ces fiches n'avait de favori ni de tome coché (vérifié dans Supabase), donc rien n'a été perdu.

**Pas un doublon** : *Ulysse* et *Ulysse (Tabou)*. Même dessinateur (Cosimo Ferri), mais des albums entièrement différents : *Tabou* est l'édition adulte. Les deux restent visibles.

Ce masquage « à l'import » est géré par Claude. Depuis octobre 2026, on peut aussi masquer **depuis l'appli** (mode propriétaire), et même ré-afficher une fiche masquée à l'import sans toucher au catalogue : voir la section suivante. Les deux mécanismes coexistent. `masquages.json` reste la trace des doublons décidés à l'import ; `bd_overrides` contient ce que Christophe a décidé dans l'appli, et **c'est lui qui l'emporte** (`hidden: false` dans `bd_overrides` ré-affiche une fiche marquée `hidden: true` dans le catalogue).

## Corriger et masquer depuis l'appli

Réservé au **mode propriétaire**. Toutes ces corrections sont stockées dans la table Supabase `bd_overrides` et appliquées **par-dessus** `data/catalog.json` à chaque chargement (`applyOverrides()` dans `app.js`). Le catalogue, lui, n'est jamais modifié. Un réimport régénère donc `catalog.json` sans rien effacer, tant que les identifiants restent stables (voir la règle des index plus haut).

**Corriger une fiche** : ouvrir la fiche → **✎ Modifier** → titre, auteur(s), un ou deux genres → Enregistrer. Un champ remis à sa valeur d'origine (ou vidé) n'est plus stocké comme correction. Une fois corrigée, la fiche affiche en petit « Corrigé par toi — d'origine : … », et le bouton **Rétablir l'original** efface toutes ses corrections d'un coup. La recherche ne trouve la fiche que sous son titre **affiché**, donc corrigé (depuis la version 2.4 ; avant, elle répondait aussi au titre d'origine, invisible à l'écran, ce qui faisait encore sortir *Louise Beauvoir* quand Christophe cherchait « CDS » après l'avoir renommée). Pour un **one-shot** renommé, son unique tome prend aussi le nouveau titre, sauf si le tome a reçu sa propre correction : l'ancien nom n'apparaît donc plus nulle part, ni dans la liste des tomes de la fiche, ni en recherche.

**Corriger ou masquer un tome** : dans la liste des tomes, le petit **✎** au bout de la ligne ouvre un mini-éditeur : libellé du tome, « Rétablir le titre d'origine », « Masquer ce tome » / « Ré-afficher ce tome ». Un tome masqué disparaît pour les visiteurs. Le propriétaire le voit encore, grisé, marqué « (masqué) » et sans numéro, pour pouvoir le ré-afficher. Il ne compte plus dans le nombre de tomes, ni dans le calcul « lu / en cours », ni dans « Tout marquer comme lu ». Les tomes d'un one-shot ne se masquent pas : on masque la fiche entière.

**Masquer une fiche** : ✎ Modifier → **Masquer cette fiche…** → confirmation. La fiche disparaît aussitôt de la grille, pour tout le monde. Un bandeau en bas d'écran propose **Annuler** pendant 8 secondes.

**Retrouver ce qui est masqué** : Réglages → **Fiches masquées et fusionnées** (visible en mode propriétaire seulement). On y trouve les doublons écartés à l'import, avec la raison, et les fiches masquées depuis l'appli, chacune avec un bouton **Ré-afficher**.

**Les coches de lecture ne bougent pas** : masquer ou renommer un tome ne change pas son index. Les clés `bd_volume_status` (`"<id>::<index>"`) restent donc valables, et un tome ré-affiché retrouve sa coche. La numérotation affichée (01, 02…) est recalculée sur les seuls tomes visibles. Elle peut donc différer de l'index stocké.

**Synchro** : les corrections arrivent en direct sur les autres appareils ouverts (Realtime, sur un canal séparé de celui des statuts : si la table n'existe pas, la synchro des statuts continue de fonctionner). Chaque modification s'affiche immédiatement. Si Supabase la refuse (hors ligne, table absente), elle est annulée à l'écran avec le message « Non enregistré : … ». Une copie locale (`localStorage`, clé `bd_overrides_cache_v1`) permet d'afficher les corrections avant la réponse de Supabase au démarrage.

**Fusionner deux fiches** : ouvrir la fiche **à garder** → ✎ Modifier → **Fusionner une autre fiche dans celle-ci…** → taper une partie du titre de l'autre fiche → la choisir → confirmer. Les tomes de l'autre fiche s'ajoutent **à la fin** de celle-ci, et l'autre fiche disparaît de la grille (et de la recherche, mais on retrouve la fiche d'accueil en tapant le titre de la fiche absorbée ou de ses tomes). Le titre, l'auteur et les genres restent ceux de la fiche gardée. Rien n'est recopié : la fusion est une simple ligne `merged_into` dans `bd_overrides`, et chaque tome garde sa clé d'origine (`"<fiche d'origine>::<index>"`). Ses coches de lecture, son libellé corrigé et son masquage éventuel suivent donc sans migration. Pour défaire : « séparer » dans la fiche (ligne « Fiche fusionnée ici »), ou Réglages → Fiches masquées et fusionnées → **Séparer**. Si on masque une fiche, les fiches qui y sont fusionnées sont masquées avec elle. Une fusion de deux one-shots donne une fiche de deux tomes, comptée comme une série ; pour deux one-shots identiques, mieux vaut en masquer un.

**Doublons probables** : Réglages → Doublons probables → **Examiner les doublons**. L'écran est calculé à la volée sur le catalogue affiché (corrections et fusions comprises), donc toujours à jour après un réimport, sans fichier à régénérer. Trois familles de suggestions :
- **Fiches qui se ressemblent** : titres presque identiques une fois retirés accents, ponctuation, mentions entre parenthèses ou crochets et mots « bis / intégrale / HD / tome » (distance de Levenshtein ≤ 15 %, ou titre court de 3 mots et plus contenu dans l'autre), **et** auteurs compatibles (au moins un en commun, ou l'un des deux inconnu). Les homonymes vérifiés à l'import (*Angor*, *Kaya*, *Le petit Prince*, *Hitler*) ont des auteurs différents et ne remontent donc pas. *Dracula* remonte quand même, Bram Stoker étant crédité des deux côtés : c'est le cas typique du « pas un doublon ». Actions : « Fusionner ici » entre deux séries ou une série et un one-shot, « Garder celle-ci » entre deux one-shots (masque l'autre), « Masquer celle-ci » côté one-shot face à une série.
- **Tomes en double dans une même fiche** : même libellé (normalisé) plusieurs fois. Chaque tome a son bouton « Masquer ».
- **One-shots qui sont peut-être un tome d'une série** : le titre du one-shot est le libellé d'un tome de série (4 lettres au moins, auteurs compatibles). Action : « Masquer le one-shot ».

Chaque suggestion a un bouton **Pas un doublon** : la décision est stockée (`"nodup:<clé1>|<clé2>"`, `not_dup = true`) et la suggestion ne revient plus. Les couvertures se touchent pour s'agrandir. Toutes les actions passent par `bd_overrides` et proposent « Annuler ». Au premier passage (octobre 2026), l'écran proposait 51 suggestions : 8 paires de fiches, 40 groupes de tomes au libellé identique (dont 14 pour *La geste des chevaliers dragons*) et 3 one-shots (*Black Widow*, *La petite reine*, *Le Lion*). Les libellés identiques ne sont pas toujours des doublons : *1984* ou *Le clan des Otori* ont plusieurs tomes au même libellé parce que le nom de fichier ne contenait que le numéro. D'où l'affichage des couvertures, pour trancher.

**Prérequis** : exécuter (ou relancer, s'il l'a déjà été au lot précédent) `supabase_bd_overrides.sql` dans le SQL Editor de Supabase. Sans la table, l'appli fonctionne comme avant ; le propriétaire voit seulement la note « Corrections indisponibles : la table bd_overrides n'existe pas encore ».

## Aide et mode d'emploi (propriétaire)

Il n'y a **pas** de mode d'emploi pour les visiteurs : ce n'était pas nécessaire (choix de Christophe, octobre 2026). Le mode d'emploi du propriétaire existe sous deux formes, **au contenu identique** :
- **dans l'appli** : Réglages (roue crantée) → dernière section, **Aide — mode d'emploi propriétaire**. Ce sont dix sujets dépliables (`<details class="help-item">`), écrits en dur dans `index.html`, dans une section `owner-only`. Ils sont donc invisibles en mode visiteur, mais présents dans le code source de la page : rien de secret ne doit y figurer ;
- **en PDF** : `Mode_emploi_proprietaire.pdf`, 4 pages A4, pour lire ou imprimer hors de l'appli. Depuis la version 2.1, il est **publié à la racine du dépôt GitHub** et s'ouvre depuis l'appli : Réglages → Aide → bouton **Mode d'emploi complet (PDF)**, dans un nouvel onglet. Le bouton n'apparaît qu'en mode propriétaire ; le fichier lui-même reste accessible à qui connaîtrait son adresse, ce qui est sans conséquence puisqu'il ne contient rien de confidentiel (ni code, ni clé). Le lien porte le numéro de version (`Mode_emploi_proprietaire.pdf?v=2.1`, ajouté par `app.js`) pour qu'un téléphone ne garde pas en cache un ancien PDF. **Le PDF doit donc être republié chaque fois qu'il change.** Son pied de page indique la date de mise à jour du mode d'emploi, pas le numéro de version de l'appli, pour ne pas devoir le régénérer à chaque livraison.

Les dix sujets : passer en mode propriétaire, suivre ses lectures, corriger une fiche, corriger ou masquer un tome, masquer une fiche et la retrouver, fusionner deux fiches, examiner les doublons probables, ce que voient les visiteurs, ajouter de nouvelles BD, bon à savoir.

**À faire vivre, comme ce README** : toute fonction ajoutée ou modifiée côté propriétaire doit être reportée dans l'aide de `index.html` **et** dans le PDF. Le PDF est produit à partir du même texte : une page HTML imprimée en PDF par Chromium.

## One-shots (dossier `BD Unique`)

Depuis octobre 2026, `D:\Christophe\Mes BD\BD Unique` contient les BD **sans suite** (un seul album) : 989 fichiers au premier import. Choix validé avec Christophe : elles sont **mélangées avec les séries** (même grille, même recherche, même tri alphabétique), avec la mention « One-shot » sur la vignette et dans la fiche, et deux puces de filtre **Séries** / **One-shots**, qui s'excluent mutuellement, pour les isoler à la demande.

⚠️ **`BD Unique` est un dossier DANS `Mes BD`** : tout futur scan des séries doit l'**exclure**, au même titre que `1 2 3 A CLASSER` et `1 2 3 A TRIER`, sinon il deviendrait une « série » de 989 tomes. Le statut « one-shot » vient du **dossier** et pas du nombre de tomes : certaines séries n'ont qu'un tome chez Christophe (*The Prism*, dont il n'a que le tome 2) sans être des one-shots.

**Tri du premier import** — sur les 989 fichiers, **968 one-shots** ont été retenus, plus :
- *Le Transperceneige* (`01`, `02`, `03`) → **série** de 3 tomes, malgré son rangement dans `BD Unique` ;
- *Survivants – Anomalies quantiques, Épisode 5* → **rattaché** à la série existante, dont il est l'épisode manquant (épisodes 1 à 4 déjà présents ; ajouté en fin de liste, aucun index existant décalé) ;
- **17 fichiers écartés** : 6 non-BD — dont **2 documents personnels** (un historique de commandes Uber Eats et une fiche technique produit, à ne surtout pas publier puisque le catalogue est sur GitHub) et 4 magazines (*Mieux Vivre Votre Argent*, *Valeurs Actuelles*, 2 × *Twenty*) —, 5 doublons d'albums déjà dans une série (*Roxelane 1*, *Louise Beauvoir – Disparition en Corse*, *Éclore*, l'intégrale de *Crusades*, *Jour J – Kennedy* qui réunit les tomes 5 et 10), et 6 doublons internes (même album en `.pdf` et `.cbz`, ou deux noms de fichier). Les revues **de BD** (*Topo*, *La Revue Dessinée*, *Nemu*) sont gardées, comme *Le Journal de Spirou* et *Le journal de Mickey*.
- **Homonymes conservés comme œuvres distinctes**, après vérification des auteurs et du nombre de pages : *Angor* (Thilliez, ≠ série de Gaudin), *Kaya* (Barbato, ≠ série de Wes Craig), *Le petit Prince* (Sfar, ≠ série Dorison/Bruneau), deux *Dracula* (Tynion IV / Georges-Bess) et deux *Hitler* (Mizuki / Croci). Règle : même titre **et** auteurs différents ⇒ deux œuvres.

**Titres** : on prend le titre des métadonnées PDF quand il correspond au nom de fichier (vérifié par similarité), car il garde la ponctuation que le nom de fichier perd (« Natacha & Co », « Forever, bitch », « Mon ami Kim Jong-un ») ; sinon on prend le nom de fichier nettoyé (`_CDS_`, `fr.downmagaz.net`, `[2021]`… retirés).
**Auteurs** : 912/968 venaient des métadonnées PDF (ou du nom de fichier), 6 ont été complétés par connaissance, soit 918 en tout, et **50 restent vides**, sans qu'aucun ait été deviné.
**Genres** : 961/968 classés par une passe « connaissance » sur titre + auteur. **633 sur 969 sont en `confidence: "low"`** dans `genre_map.json` (genre déduit plutôt que connu, `source: "oneshot_pass1"`). C'est la partie la moins fiable du catalogue, à corriger au fil de l'eau.

**Côté appli**, le passage de ~1000 à ~2000 vignettes a imposé un **chargement différé** : tout charger à l'ouverture aurait représenté ~140 Mo sur l'iPhone. On n'utilise volontairement **pas** `loading="lazy"` (natif), qui s'était montré peu fiable ici, mais un `IntersectionObserver` explicite (marge de 800 px) dans `app.js`, avec un repli sur le chargement direct pour les navigateurs qui ne le connaissent pas. Mesuré au test : 35 vignettes chargées à l'ouverture au lieu de 1971. La recherche texte attend aussi 150 ms après la dernière frappe avant de reconstruire la grille.

**Couvertures `.cbr` enfin lisibles** : le pipeline initial ne savait pas ouvrir les archives RAR (pas d'`unrar` sur la VM). Le paquet Python `libarchive-c`, qui s'appuie sur `libarchive` déjà présent, les lit très bien. `extract_covers_generic.py` (VM, `~/bd-catalog/`) gère donc PDF, CBZ et CBR à partir d'un fichier `pending_*.json`. Effet de bord : **46 des 48 tomes anciens restés sans couverture** en ont maintenant une (dont les 37 *Astérix*). Les 2 restants sont des **fichiers abîmés sur le disque** : `Jeremiah/Divers/Le monde selon Jeremiah.pdf` ne contient que des zéros, et l'intégrale 4 de *The Boys* est un PDF sans aucune page. Un `.cbz` de *La geste des chevaliers dragons* était en réalité une archive RAR renommée.

## Points restés ouverts (au moment de la rédaction)

**46 BD sans genre identifié** (toutes antérieures à octobre 2026 : les 150 séries ajoutées ensuite ont toutes au moins un genre) (voir section "Genres" ci-dessus pour la méthode) — champ `genre: []`, invisibles au filtre genre tant qu'elles n'ont pas été classées manuellement dans `genre_map.json`. Par ailleurs, une bonne partie des genres non vérifiés en ligne (`confidence: "low"` dans `genre_map.json`) restent des estimations à corriger au fil de l'eau si une erreur saute aux yeux.

**7 BD sans auteur identifié**, même après recherche (là aussi toutes antérieures à octobre 2026 ; les 150 séries ajoutées ensuite ont toutes un auteur, tiré des métadonnées PDF) : *1984, Arena, Arsène Lupin, Climax, Forbidden Zone, RAF Royal Air Force, Utopie*. Champ `author` à `null` dans le catalogue — l'appli affiche "Auteur non renseigné".

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

1. `covers/`, les dossiers `volume_covers*/`, `uploader.html` et les fichiers de travail sont exclus via `.gitignore` — le commit ne contient que le code, `data/catalog.json` (~1 Mo) et `Mode_emploi_proprietaire.pdf` (lié depuis Réglages → Aide).
2. Pousser sur GitHub (dépôt `ma-bibliotheque-bd`, via GitHub Desktop).
3. Settings → Pages → source = branche `main`, dossier racine.
4. Site en ligne à `https://<pseudo-github>.github.io/ma-bibliotheque-bd/` après 1-2 minutes.
5. Le lien n'est indexé nulle part mais reste techniquement accessible à qui aurait l'URL exacte (pas de mot de passe sans offre GitHub payante).

## Versions des livraisons

**Règle (à appliquer à chaque livraison de l'application, par Claude ou une autre IA) :**
1. Augmenter `APP_VERSION` dans `app.js` (et `APP_VERSION_DATE` = date du jour, format `AAAA-MM-JJ`) :
   - `+0.1` pour une livraison ordinaire (correctif, retouche, petite fonction) : 2.0 → 2.1 → 2.2…
   - `+1.0` pour une refonte (nouvel écran, changement de structure) : 2.9 → 3.0.
2. Reporter **le même numéro** dans `index.html`, sur les quatre liens `themes.js?v=…`, `style.css?v=…`, `config.js?v=…` et `app.js?v=…`.
3. Ajouter une ligne au tableau ci-dessous et mettre à jour la ligne « Version actuellement livrée » en tête de ce fichier.
4. Livrer ensemble `index.html` et `app.js` (le numéro est dans les deux), plus les autres fichiers modifiés.
5. Après dépôt sur le PC de Christophe, relire les fichiers sur le PC et comparer leur empreinte md5 à la version testée (un envoi a déjà écrit une ancienne version sans signaler d'erreur).

Une livraison qui ne touche que les données (`data/catalog.json`, couvertures, scripts SQL) ne change pas le numéro.

| Version | Date | Contenu |
|---|---|---|
| 2.4 | 24/10/2026 | **Recherche limitée à ce qui est affiché** : une fiche ou un tome renommé ne répond plus à son ancien nom ; un one-shot renommé renomme aussi son tome. Aide et PDF mis à jour. |
| 2.3 | 24/10/2026 | **Vignettes auto-réparantes** : une couverture en échec est retentée deux fois, et un filet de sécurité charge toute vignette proche de l'écran que le chargement différé aurait ratée. Corrige les vignettes vides signalées par Christophe. |
| 2.2 | 24/10/2026 | **Barre alphabétique** collante au-dessus de la grille et séparateurs de lettre, sur le modèle de l'appli ebooks. Correction de `overflow-x` sur `body`, qui empêchait les éléments collants. Aide et PDF complétés ; pied de page du PDF déplacé pour qu'il tienne sur 4 pages. |
| 2.1 | 24/10/2026 | Bouton **Mode d'emploi complet (PDF)** dans Réglages → Aide (propriétaire), qui ouvre `Mode_emploi_proprietaire.pdf` publié à la racine du site. Pied de page du PDF daté plutôt que numéroté. |
| 2.0 | 24/10/2026 | Premier numéro de version (2.0 plutôt que 1.0, choix de Christophe, l'appli ayant déjà eu de nombreuses livraisons). Réglages et Doublons probables deviennent de vraies pages (`#/reglages`, `#/doublons`) ; sections pliables avec mémoire sur l'appareil et « Tout déplier · Tout replier » ; numéro de version en bas des Réglages ; un seul `?v=` pour les quatre fichiers. Aide et PDF complétés. |

Les livraisons antérieures n'étaient pas numérotées ; leur détail est dans l'historique ci-dessous.

## Historique des décisions notables

- **3ᵉ mise à jour delta** (27 octobre 2026) : **14 nouvelles séries**, **13 séries enrichies** (37 tomes ajoutés à la fin, dont 7 pour *Triple galop* et 6 pour *W.I.T.C.H*) et **9 nouveaux one-shots** de `BD Unique`. Catalogue : 2024 → **2047 entrées** (1061 séries + 986 one-shots), 8330 → **8407 albums**. 77 couvertures extraites (dossier `volume_covers_delta_27oct/`, à envoyer via `uploader.html`). Pas de changement de version de l'appli : la livraison ne touche que les données.
  - **Dossier renommé parce que son compteur a changé** : `Les tuniques bleues (69-69)` est devenu `(70-70)`. Le script le reconnaît désormais tout seul : même fiche, même id, coches de lecture conservées, tome 70 ajouté à la fin, titre de base mis à jour.
  - **Nom de fichier en NFD** : le tome 4 des *Suites vénitiennes* (« Gorée ») est écrit sur le disque avec un accent décomposé ; l'extraction des couvertures retrouve maintenant le nom brut.
  - **Genres** choisis par Claude à partir des auteurs et des couvertures, confiance « low » pour *Du pied gauche*, *Graine de Vaurien* et *L'Élu*. Les auteurs viennent tous des métadonnées PDF.
  - **Procédure automatisée** : choix de Christophe d'être autonome en gardant Claude (« option 3 ») ; les scripts sont rangés dans `outils_delta/` et la procédure est enregistrée pour être relancée d'une phrase. Le nouveau jeu de scripts a rejoué ce delta à l'identique (catalogue octet pour octet égal à celui du calcul de contrôle). Suites barre alphabétique (27), vignettes (16) et recherche (19) repassées sur le nouveau catalogue.

- **Version 2.4 — recherche sur ce qui est affiché** (24 octobre 2026) : après avoir renommé *Louise Beauvoir_CDS_* en *Louise Beauvoir* dans l'appli, Christophe la retrouvait encore en cherchant « CDS ». C'était voulu : la recherche répondait aussi au titre d'origine. Mais ce titre n'est visible nulle part, et Christophe cherche « CDS » justement pour repérer ce qui reste à renommer. Choix de Christophe : limiter la recherche à ce qui est affiché. Au passage, un one-shot renommé gardait l'ancien nom sur son unique tome, visible dans la fiche : il prend désormais le nouveau titre. Nouvelle suite `test9_search.js` (19 vérifications) ; les suites Réglages (54), barre alphabétique (27), vignettes (16), lots 3 et 4 et croix repassent à l'identique.
- **Version 2.3 — vignettes sans couverture** (24 octobre 2026) : Christophe signale des vignettes vides dans la grille (*Jason et la Toison d'Or*, *J'ai arrêté Otto Abetz*, *Je suis au-delà de la mort!*…) alors que les couvertures s'affichent dans la fiche. Vérifié : le catalogue est correct (la vignette pointe sur la couverture du tome 1) et les fichiers répondent bien sur Supabase (200). Correction décrite dans la section « Chargement des vignettes ». Les suites barre alphabétique (27), Réglages (54), lots 3 et 4 et croix repassent à l'identique.
- **Version 2.2 — barre alphabétique** (24 octobre 2026) : demande de Christophe, reprise de son appli ebooks. Nouvelle suite Playwright `test7_az.js`, 27 vérifications sur le vrai catalogue (2017 fiches visibles). Elle couvre l'ordre des 27 cases, la correspondance case active / séparateur, chaque fiche sous la bonne lettre, aucune fiche perdue, les lettres grisées, la barre qui reste accrochée et le séparateur visible après un saut (PC et iPhone), l'adresse et l'historique inchangés, la recherche courte qui masque la barre, le filtre One-shots et un genre qui la recalculent, la barre absente de la page Réglages, les cases de taille correcte et l'absence de débordement sur iPhone. Les suites Réglages (54), lots 3 et 4 et croix d'effacement repassent à l'identique.
- **Version 2.1 — mode d'emploi PDF accessible depuis l'appli** (24 octobre 2026) : demande de Christophe, qui place le PDF à la racine du dépôt. Bouton dans la section Aide des Réglages, ouverture dans un nouvel onglet, lien versionné. Suite `test6_reglages.js` portée à 54 vérifications (bouton invisible pour un visiteur, visible pour le propriétaire, lien qui sert bien un PDF, ouverture dans un nouvel onglet, cible tactile de 44 px) ; elle passe en entier.
- **Version 2.0 — Réglages en page, sections pliables, numéro de version** (24 octobre 2026) : demande de Christophe, sur le modèle de son appli ebooks (`deepblue67/ma-bibliotheque`, §4.30 de son README). Les deux fenêtres (Réglages, Doublons probables) sont remplacées par des pages routées par l'adresse. Vérifié par une nouvelle suite Playwright, `test6_reglages.js` : 47 vérifications (sections visibles selon visiteur/propriétaire, repli et mémoire après rechargement, Tout déplier/replier, retour par le lien, par le bouton du navigateur et par Échap, retour à la même position dans la grille, `#/doublons` refusé au visiteur, déverrouillage depuis la page, action sur la page Doublons sans perdre la position, fiche ouverte refermée quand on change de page, cibles tactiles de 44 px et aucun débordement sur iPhone, aucune erreur JavaScript). Les suites des lots 3 et 4 repassent à l'identique.

- **Croix d'effacement** dans les champs Titre et Auteur (24 octobre 2026) : une petite croix apparaît dès qu'un champ contient du texte et le vide d'un clic (remet le filtre à zéro et redonne le focus au champ). `app.js?v=13`, `style.css?v=13` (croix dimensionnée pour le tactile iPhone/iPad).
- **2ᵉ mise à jour delta + 2ᵉ lot de one-shots** (24 octobre 2026) : **44 nouvelles séries**, **61 séries enrichies** (nouveaux tomes dans des dossiers déjà présents) et **9 nouveaux one-shots** de `BD Unique`. Catalogue : 1971 → **2024 entrées** (1047 séries + 977 one-shots), 8101 → **8330 albums**. 229 couvertures extraites (dossier `volume_covers_delta_24oct/`, à envoyer via `uploader.html`). `app.js?v=12`.
  - **Règle d'or confirmée : insertion *append-only*.** Les tomes déjà présents ne sont **jamais** réordonnés ; les nouveaux fichiers sont ajoutés **à la fin** de la série. C'est ce qui garantit que les coches de lecture et les corrections (indexées par position dans `bd_volume_status` / `bd_overrides`) ne bougent pas, sans avoir à migrer quoi que ce soit. Vérifié : 0 tome existant déplacé, 0 couverture existante modifiée, 0 id perdu. Contrepartie : les nouveaux tomes ne sont pas intercalés dans l'ordre « trié » — ils apparaissent après les anciens.
  - **One-shot homonyme protégé** : un dossier de `Mes BD` est toujours rattaché à une **série**, jamais à un one-shot de même titre (sinon le dossier *Angor* (Gaudin) enrichissait par erreur le one-shot *Angor* (Thilliez)). Mêmes garde-fous pour *Kaya*.
  - **Renommages (accent perdu)** : `C'est ou le plus loin d'ici`, `La foret du temps`, `Les ages perdus` sont les mêmes séries qu'au catalogue (accent retiré du dossier) → rattachées à l'entrée existante (id et coches conservés), titre accentué gardé.
  - **Doublons laissés à l'arbitrage dans l'appli** (choix de Christophe) : les variantes « MANQUE CDS » / « CDS » / « a renommer » et `Servitude`/`Servitudes` sont importées telles quelles. Pour qu'elles remontent dans l'écran *Doublons probables*, `dupBase` retire désormais les marqueurs « MANQUE … », « CDS »/« CDS99 » et « a renommer » (8 paires remontent en correspondance exacte, `Servitude`/`Servitudes` par similarité).
  - **Dossiers spéciaux inchangés** : les 21 séries à sous-dossiers (Tintin, Astérix, Les mondes de Leo…) ne sont pas re-scannées ; leurs écarts disque/catalogue sont des éditions en double déjà écartées à la main, pas des nouveautés.
  - **1 doublon one-shot écarté** : *Le Manager Alchimiste* re-téléchargé sous un autre nom de fichier (`fr.downmagaz.net`) — non réimporté.


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
- Fonctionnalité ajoutée : filtre "lu" en 3 états au lieu de 2. Constat de Christophe : le statut "lu" d'une série n'était trouvable que si **tous** ses tomes étaient cochés — impossible de retrouver une série commencée mais pas terminée. Le chip "Lus"/"Non lus" est devenu trois chips indépendants : **Lus** (tous les tomes cochés, inchangé), **En cours** (au moins un tome coché, mais pas tous — nouveau), **Non lus** (aucun tome coché — sens resserré, avant ce changement une série partiellement lue y était classée par défaut). Ajout d'une pastille de progression sur la vignette de la grille pour les séries en cours (ex. "3/11 lus"), à la place de la pastille "Lu" qui ne s'affiche que pour une série intégralement terminée. Calcul entièrement côté client (`countRead()`/`isInProgress()` dans `app.js`), aucun changement de schéma Supabase.
- Mise à jour du contenu (octobre 2026) : **+150 séries et +807 albums** d'un coup (852 → 1002 séries, 6323 → 7130 albums). 14 séries existantes ont aussi gagné des tomes, dont *Tanguy et Laverdure* (6 → 38) et *Les Maîtres de l'Orge*, qui était une fiche vide (0 tome) parce que le scan initial n'avait pas vu que ses albums vivaient dans des sous-dossiers `CBZ/` et `pdf/`. Les 21 dossiers à sous-dossiers (Thorgal, Alix, Lucky Luke, Donjon, Michel Vaillant, XIII…) ont été re-vérifiés règle par règle : inchangés. Auteurs des nouveaux titres : **150/150**, dont 149 lus directement dans les métadonnées PDF — c'est de loin la meilleure source, bien meilleure que la recherche web (84/150, et souvent des noms incomplets : « Makyo » au lieu de « Pierre Makyo »). Réflexe à garder : **toujours tenter les métadonnées PDF avant de lancer des agents de recherche**. Genres : 150/150, même taxonomie fermée de 14 valeurs. Effet de bord corrigé au passage : 350 tomes affichaient un libellé **vide** dans la fiche détail (fichiers nommés `Serie_Tome_NN.pdf` sans sous-titre, que l'ancien `clean_volume_name` réduisait à une chaîne vide) — ils affichent désormais « Tome NN ».
- Leçon technique de cette mise à jour : les noms de fichiers et de dossiers de Windows arrivent tantôt en **NFC**, tantôt en **NFD** (`é` en un seul caractère, ou `e` + accent combinant). Deux conséquences vécues : un dossier (`Le Complexe du chimpanzé`) restait introuvable alors qu'il apparaissait dans la liste de son parent, et deux PDF refusaient de s'ouvrir par leur chemin reconstruit. Règle à suivre : **comparer les noms en NFC, mais toujours ouvrir les fichiers avec le nom brut lu sur le disque** (ou le retrouver en comparant les formes NFC du contenu réel du dossier).
- Suite de la mise à jour d'octobre 2026 : Christophe a préféré **les tomes dans l'ordre** plutôt que les nouveautés ajoutées en fin de liste. Vérification faite dans Supabase, **3 séries seulement** avaient des tomes cochés (*Alter Ego*, *Lloyd Singer - Makabi*, *Louise Beauvoir*) et aucune n'était touchée par le tri : la remise en ordre s'est donc faite sans écrire une seule ligne dans `bd_volume_status`. Les 806 couvertures déjà extraites ont été **réutilisées telles quelles**, en les rattachant par *fichier source* et non par position — sans ça, le tri aurait décalé les couvertures d'un tome. Aucune ré-extraction, aucun renvoi vers Supabase Storage.
- Bug corrigé au passage (et vrai piège à retenir) : la première version du rapprochement a **dupliqué un tome** de *Le Réseau Papillon*, qui s'est retrouvée avec 10 tomes pour 9 fichiers. Cause : son tome 07 est nommé `Le_Reseau_Papillon_...` sans accent et son tome 06 est encodé en NFD, deux cas où l'ancien script avait stocké le **nom de fichier entier** comme libellé — forme que mon rapprochement n'essayait pas. Détecté par un contrôle simple qu'il faut garder systématiquement : *nombre de tomes d'une série simple == nombre de fichiers album dans son dossier*. Les deux autres contrôles utiles : aucune couverture d'origine ne disparaît, et les couvertures d'origine restent en ordre numérique croissant au sein d'une série (sinon une couverture s'est rattachée au mauvais tome).
- Import des **one-shots** (octobre 2026) : +968 one-shots et +1 série (*Le Transperceneige*), soit 1971 entrées et 8101 albums. Mélangés avec les séries, avec une mention « One-shot » et des puces de filtre *Séries* / *One-shots*. Détails dans la section « One-shots ». L'interface gagne un **chargement différé fiable** des vignettes (IntersectionObserver), indispensable au-delà de ~1000 vignettes. Les 3 séries qui ont des tomes cochés (*Alter Ego*, *Lloyd Singer - Makabi*, *Louise Beauvoir*) n'ont pas été touchées. Le doublon de *Louise Beauvoir* trouvé dans `BD Unique` a été écarté plutôt qu'ajouté à la série, ce qui évitait au passage de décaler ses index.
- Piège rencontré (et corrigé avant tout envoi) : **Windows ne distingue pas les majuscules dans les noms de fichiers**. La couverture du one-shot `Le_petit_Prince_001.jpg` a donc écrasé, dans `volume_covers/`, celle de la série `Le_Petit_Prince_001.jpg`, alors que les deux noms semblaient différents dans le conteneur Linux. Restaurée depuis la copie de la VM (vérifiée par empreinte md5) et renommée `Le_petit_Prince_2_001.jpg`. Règle désormais appliquée : **l'unicité des noms de couverture (et des `id`) se vérifie sans tenir compte de la casse**. Supabase Storage, lui, distingue la casse, ce qui explique que le problème ne se voie qu'en local.
- Recherche améliorée et thèmes (octobre 2026) : la recherche porte désormais aussi sur les titres de tomes, accepte plusieurs mots dans le désordre et ignore apostrophes et ponctuation (section « Recherche »). Ajout d'une roue crantée et d'un panneau Réglages avec 10 thèmes visuels (section « Thèmes et réglages »). Le thème par défaut est l'ancien design, inchangé à un détail près : le bandeau d'info sombre des vignettes s'étend désormais jusqu'en bas de la carte. Les 10 thèmes ont été contrôlés à l'écran avec les vraies polices ; c'est ce contrôle qui a fait corriger deux problèmes de contraste avant livraison (la mention « One-shot » dorée était illisible sur les vignettes à fond blanc, d'où la variable dédiée `--card-oneshot`, et le titre blanc était trop pâle sur le rose du thème Pastel). Pas de changement de catalogue ni de Supabase pour ce lot.
- **Mode propriétaire** et **masquage des doublons** (octobre 2026) : protection par code choisie (option a), statuts invisibles pour les visiteurs, thème par appareil (déjà le cas), et 7 séries en double masquées dès maintenant. L'appli affiche 996 séries, 968 one-shots et 7930 albums visibles. Test en navigateur des cinq situations : non configuré, visiteur, mauvais code refusé, propriétaire, retour en visiteur après « Quitter » ou après un changement d'empreinte.
- **Mode d'emploi du propriétaire** (17 octobre 2026) : aide en ligne dans Réglages, visible en mode propriétaire seulement, et le même texte en PDF (`Mode_emploi_proprietaire.pdf`). Pas de mode d'emploi visiteur. `style.css?v=11`. Vérifié en navigateur : l'aide est visible pour le propriétaire sur PC et sur mobile, et invisible pour un visiteur.
- **Fusion et doublons probables** (17 octobre 2026) : fusion d'une fiche dans une autre depuis l'éditeur de fiche (ligne `merged_into`, les tomes gardent leur clé d'origine), « séparer » depuis la fiche ou les Réglages, et écran **Doublons probables** calculé à la volée (fiches proches, tomes au même libellé, one-shot = tome), avec « pas un doublon » mémorisé. Deux colonnes ajoutées à `bd_overrides` (script SQL à relancer). `app.js?v=11`, `style.css?v=10`. Test en navigateur (vrai supabase-js, base simulée) : fusion depuis l'écran des doublons et depuis l'éditeur, coche de lecture d'un tome absorbé écrite sous sa clé d'origine, recherche par un tome absorbé, séparation, masquage d'un tome en double et d'un one-shot, « pas un doublon », visiteur (fusion visible, aucun outil propriétaire), et base **sans** les nouvelles colonnes (les corrections simples passent, la fusion est refusée proprement). Le test du lot 3 repasse à l'identique.
- **Corriger et masquer depuis l'appli** (17 octobre 2026) : nouvelle table `bd_overrides` appliquée par-dessus le catalogue, pour que les corrections survivent aux réimports. On peut corriger le titre, l'auteur et les genres d'une fiche ou le libellé d'un tome, masquer une fiche (avec « Annuler ») ou un tome, et ré-afficher depuis Réglages → Fiches masquées, y compris les doublons écartés à l'import. Les index de tomes ne changent jamais, donc les coches de lecture restent en place. `app.js?v=10`, `style.css?v=9`. Testé en navigateur avec le vrai client supabase-js et une base simulée : visiteur (corrections visibles, aucun bouton d'édition, tomes masqués absents), propriétaire (édition d'une fiche puis rétablissement, masquage d'une fiche puis annulation, masquage/démasquage d'un tome, « tout marquer lu » limité aux tomes visibles, ré-affichage d'un doublon d'import, annulation à l'écran si Supabase refuse l'écriture), en thème clair et sombre, sur PC et sur mobile.
- Mode propriétaire **mis en service** (16 octobre 2026) par la variante sans double publication : empreinte calculée par Christophe sur son PC avec la commande PowerShell, puis inscrite dans `config.js` (`config.js?v=4`). Le code n'a jamais transité par la conversation, seule l'empreinte y est passée. Leçon au passage : un envoi de fichier vers le PC a deux fois écrit **l'ancienne version** d'un fichier sans signaler d'erreur (`config.js`, puis `README.md`). Depuis, chaque livraison est contrôlée en comparant l'empreinte md5 des fichiers sur le PC à celle des fichiers préparés.
