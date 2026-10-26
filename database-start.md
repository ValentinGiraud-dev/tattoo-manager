Modèle de données — Tattoo Manager

Ce document définit la première version du modèle de données de l’application.

L’objectif est de commencer avec un modèle simple et évolutif.

La V1 repose sur 3 notions principales :

* Clients
* Séances
* Produits / Traçabilité

Les besoins évolueront probablement. Il faut donc éviter de créer dès maintenant une architecture trop complexe.

⸻

🧩 Vue d’ensemble

Les relations principales sont :

Client
  │
  └───< Séances
            │
            └───< Produits utilisés

Un client peut avoir plusieurs séances.

Une séance appartient obligatoirement à un client.

Une séance peut utiliser plusieurs produits.

Un même produit pourra potentiellement être utilisé dans plusieurs séances, selon son type et son cycle de vie.

⸻

👤 Client

Un client représente une personne suivie par la tatoueuse.

Informations V1

Client
├── id
├── first_name
├── last_name
├── birth_date
├── email
├── phone
├── notes
├── archived_at           vide = fiche active
├── created_at
└── updated_at

Champs

Champ	Type conceptuel	Obligatoire	Description
id	UUID / ID	Oui	Identifiant unique
first_name	TEXT	Oui	Prénom
last_name	TEXT	Oui	Nom
birth_date	DATE	Non	Date de naissance
email	TEXT	Non	Adresse email
phone	TEXT	Non	Numéro de téléphone
notes	TEXT	Non	Notes libres
created_at	DATETIME	Oui	Date de création
updated_at	DATETIME	Oui	Dernière modification
archived_at	DATETIME	Non	Renseigné : le client est archivé

Une fiche (client, séance, projet, lot, fiche produit) se supprime seulement si rien ne la relie. Sinon elle s'archive : elle quitte les listes actives et les sélecteurs, et ses traces restent avec la mention « archivé ». L'archivage ne cascade pas. Archiver un client remet en stock la consommation nette de ses lots à usage unique. Archiver une séance, un projet, un lot ou une fiche ne bouge pas le stock. Le désarchivage est la seule écriture admise sur une fiche archivée. Les acomptes, paiements, liens, mouvements et documents ne s'archivent pas : ils s'annulent avec un motif.

Les informations pourront être enrichies plus tard.

Exemples potentiels :

* adresse ;
* informations supplémentaires ;
* documents ;
* photos ;
* historique ;
* préférences ;
* tags ;
* consentements.

Ces éléments ne sont pas nécessaires pour la V1.

⸻

🖋️ Séance

Une séance représente une prestation de tatouage réalisée pour un client.

Chaque séance appartient obligatoirement à un seul client.

Client
   │
   ├── Séance
   ├── Séance
   └── Séance

Informations V1

Session
├── id
├── client_id
├── date
├── status
├── body_area
├── description
├── notes
├── consent_questionnaire
├── health_questionnaire
├── created_at
└── updated_at

Champs

Champ	Type conceptuel	Obligatoire	Description
id	UUID / ID	Oui	Identifiant unique
client_id	FK	Oui	Client concerné
date	DATETIME	Oui	Date/heure de la séance
status	TEXT / ENUM	Oui	Statut de la séance
body_area	TEXT	Non	Zone du corps
description	TEXT	Non	Description du tatouage
notes	TEXT	Non	Notes liées à la séance
created_at	DATETIME	Oui	Date de création
updated_at	DATETIME	Oui	Dernière modification

⸻

📋 Statut d’une séance

Pour commencer, les statuts peuvent être très simples :

PLANNED
COMPLETED
CANCELLED
RESCHEDULED

Cette liste pourra évoluer.

Par exemple :

PLANNED
CONFIRMED
IN_PROGRESS
COMPLETED
CANCELLED
NO_SHOW

Il n’est pas nécessaire de gérer tous ces cas dans la V1.

⸻

📝 Questionnaires

Chaque séance doit pouvoir être associée à deux questionnaires :

1. Questionnaire de consentement
2. Questionnaire de santé

Pour la V1, les questionnaires seront remplis ou importés manuellement.

Le système devra également permettre leur export, afin de pouvoir les envoyer au client.

⸻

Questionnaire de consentement

Les champs ne sont pas encore définis.

Ils seront ajoutés lorsque le contenu du questionnaire sera spécifié.

ConsentQuestionnaire
├── id
├── session_id
├── ...
├── created_at
└── updated_at

⸻

Questionnaire de santé

Même principe.

Les champs seront définis ultérieurement.

HealthQuestionnaire
├── id
├── session_id
├── ...
├── created_at
└── updated_at

Important

Les questionnaires doivent être considérés comme des données liées à une séance, et non simplement au client.

Un client peut avoir des réponses différentes d’une séance à l’autre.

⸻

📦 Produit

Un produit à l'écran est un lot : ce qu'on achète et ce qu'on trace. Une encre a en plus un flacon par bouteille, parce que chaque bouteille s'ouvre à une date différente.

Exemples :

* encre ;
* aiguille ;
* cartouche ;
* consommable ;
* autre matériel.

Les lots sont créés à la main. La possibilité de scanner sera ajoutée ultérieurement.

⸻

Informations

Lot
├── id
├── name
├── lot_number
├── creation_date
├── expiration_date
├── single_use
├── after_opening_months
├── product_url
├── created_at
└── updated_at

Champs du lot

Champ	Type conceptuel	Obligatoire	Description
id	UUID / ID	Oui	Identifiant unique
name	TEXT	Oui	Nom du produit
lot_number	TEXT	Oui	Numéro de lot, unique avec le nom
creation_date	DATE	Non	Date de fabrication indiquée sur le lot
expiration_date	DATE	Oui	Date de péremption imprimée
after_opening_months	INTEGER	Non	Mois d'utilisation après ouverture. Interdit si usage unique
single_use	BOOLEAN	Oui	1 = usage unique, 0 = encre
product_url	TEXT	Non	Lien vers la fiche du produit
created_at	DATETIME	Oui	Date d'ajout
updated_at	DATETIME	Oui	Dernière modification

L'identité d'un lot est le couple nom + numéro, sans tenir compte de la casse.

Usage unique : pas de flacon, pas de `opened_at`, pas de `after_opening_months`. La limite utile est `expiration_date`.

Encre : un flacon par bouteille.

Unit
├── id
├── lot_id
├── opened_at
├── created_at
└── updated_at

`opened_at` vide : flacon scellé, seule `expiration_date` compte. Une fois ouvert, la limite utile est la plus proche entre `expiration_date` et `opened_at` plus `after_opening_months`.

Exemple :

```text
expiration_date = 2030-01-01
after_opening_months = 6
opened_at = 2026-10-08
```

La limite utile est le 2027-04-08.

⸻

🔗 Produits utilisés pendant une séance

Une séance peut utiliser plusieurs lots ou flacons.

Un lot usage unique, et un flacon d'encre, peuvent servir plusieurs séances.

SessionUsage
├── id
├── session_id
├── lot_id
├── unit_id
└── created_at

Exactement un de `lot_id` ou `unit_id` est rempli.

Exemple

Session #123
    │
    ├── Encre noire / LOT-123 / flacon ouvert le 8 octobre
    ├── Encre rouge / LOT-456 / flacon scellé
    └── Aiguille 3RL / LOT-789 / 2 pièces

Lier une aiguille consomme la quantité sur le lot. Lier un flacon ne change pas le stock.

Cette table constitue la base de la traçabilité. Les liens ne se suppriment pas.

Annulation d'un lien (migration 007)

Un lien saisi par erreur s'annule avec un motif obligatoire. Il reste dans `session_usages` et apparaît barré dans l'historique.

SessionUsageVoid
├── id
├── session_usage_id   unique : un lien s'annule une seule fois
├── reason             obligatoire
└── created_at

Pour un usage unique, la quantité consommée revient en stock par un mouvement `ADJUSTMENT` lié à la séance. Pour une pièce, le stock ne change pas. Un lien annulé ne peut pas être relié à la même séance, et les mouvements d'un lien annulé ne peuvent plus être défaits.

Questionnaires et documents signés (migration 008)

Déroulé : la tatoueuse remplit avec le client, l'app imprime le PDF d'origine pré-rempli, le client signe sur papier, le scan ou la photo est joint à la séance.

SessionForm
├── id
├── session_id
├── kind            HEALTH | CONSENT (un par séance)
├── form_version    version du formulaire papier
├── answers         JSON (structs Rust HealthAnswers / ConsentAnswers)
├── created_at
└── updated_at

SessionDocument
├── id
├── session_id
├── kind            HEALTH_SIGNED | CONSENT_SIGNED | OTHER
├── stored_name     fichier dans documents/<session_id>/
├── original_name
├── size_bytes
├── created_at
├── void_reason     annulation : une seule fois, motif obligatoire
└── voided_at

* Un document signé non annulé fige les réponses du formulaire correspondant.
* Le client a une adresse (optionnelle), reprise sur le consentement.
* L'âge et la majorité se calculent à la date de la séance.
* Les PDF d'origine sont dans `src-tauri/assets/forms/`. Le pré-remplissage écrit aux coordonnées des formulaires v1 (`services/form_pdf.rs`).

Catégories de produits (migration 011)

ProductCategory
├── id
├── parent_id       catégorie parente, vide pour une catégorie de premier niveau
├── name            unique parmi les sœurs (sans tenir compte de la casse)
├── created_at
└── updated_at

Lot (ajout)
└── category_id     optionnel

* Autant de niveaux que voulu : « Encres », « Aiguilles › RL › 3RL ».
* Une catégorie ne peut pas être rangée dans elle-même ni dans une de ses sous-catégories.
* Une catégorie inclut ses sous-catégories quand on filtre la liste des produits.
* Supprimer une catégorie fait remonter son contenu (sous-catégories et lots) d'un niveau.
* La catégorie d'un lot reste modifiable même après usage en séance : elle ne fait pas partie de son identité.
* L'export « Registre de traçabilité » ajoute le chemin de la catégorie en dernière colonne.

Fiches produit (migration 013)

ProductSheet (table product_sheets)
├── id
├── name
├── brand                 optionnelle
├── category_id           rangement ; les lots de la fiche y sont rangés aussi
├── single_use            type imposé aux lots de la fiche
├── after_opening_months  modèle pour les prochains lots
├── product_url
├── created_at
└── updated_at

Lot (ajout)
└── product_id     fiche produit ; vide pour un lot reçu avant les fiches

* Une fiche = ce que l'atelier achète et réachète (« Dynamic Triple Black »). Un lot = une réception (numéro, péremption, pièces).
* Identité d'une fiche : nom + marque, sans tenir compte de la casse.
* Un lot reçu avec une fiche prend son nom (« Marque Nom »), son type, sa durée après ouverture, son lien et sa catégorie.
* La migration n'ajoute que la table et la colonne : les lots existants restent sans fiche. L'écran Produits les signale et propose de créer leur fiche (avec leurs homonymes) ou d'en choisir une.
* Rattacher un lot ne change ni son nom, ni son numéro, ni sa péremption : l'identité tracée reste celle enregistrée. Le type du lot doit être celui de la fiche.
* Le type d'une fiche qui a des lots ne change plus. Une fiche qui a des lots ne se supprime pas : elle s'archive.
* Stock d'une fiche : somme des lots non périmés ; le stock des lots périmés est montré à part.
* Table nommée product_sheets pour ne pas la confondre avec l'ancienne table products (supprimée en 010).

Stock bas (migration 014)

ProductSheet (ajout)
└── low_stock_threshold   vide = seuil de la catégorie ; 0 = pas d'alerte ; N = alerte à N ou moins

ProductCategory (ajout)
├── low_stock_mode        EACH (chaque produit) | TOTAL (somme de la catégorie)
└── low_stock_threshold   rempli avec le mode, sinon vide

* Stock surveillé d'une fiche : ses lots non périmés (pièces en stock pour l'usage multiple). Les lots sans fiche ne sont pas surveillés.
* Alerte quand le stock est inférieur ou égal au seuil (une fiche sans aucun lot est à 0).
* Seuil d'une fiche : le sien ; sinon celui de la catégorie la plus proche réglée « chaque produit », en remontant les catégories parentes.
* Une catégorie réglée « au total » alerte sur la somme du stock des fiches de sa branche (sous-catégories comprises), pour des produits interchangeables.
* Alertes : accueil (« À traiter »), Produits (badge, filtre, alerte « au total »), fiche produit, et au moment de lier un produit à une séance.

Alerte d'expiration (migration 020)

ProductSheet (ajout)
└── expiry_warning_days   vide = 30 jours ; 0 = pas d'alerte anticipée ; N = alerte si la limite utile tombe dans les N jours

* Le délai se règle sur la fiche seulement. Un lot sans fiche garde 30 jours.
* Limite utile : date d'expiration, ou la plus proche avec la durée après ouverture pour une pièce ouverte. Calcul en Rust, comme le reste de la péremption.
* Un lot ou une pièce déjà périmé reste signalé, même si l'alerte anticipée est coupée.
* Alertes : accueil (« Bientôt périmés à racheter ») et bandeau de la fiche.

Journal d'audit (migration 012)

AuditLog
├── seq             numéro croissant (ordre du journal)
├── occurred_at     horodatage UTC
├── action          CREATE | UPDATE | DELETE, ou un événement de l'app
├── entity          client, session, payment, lot, category… ou app
├── entity_id
├── label           nom lisible de la fiche au moment de l'écriture
├── client_id       fiches auxquelles l'entrée se rattache (historique de fiche)
├── session_id
├── lot_id
├── before_json     valeurs des champs avant
└── after_json      valeurs des champs après

* Chaque création, modification ou suppression dans une table métier ajoute une ligne, par déclencheur SQLite, dans la même transaction que l'écriture. Une modification qui ne change que `updated_at` n'en ajoute pas.
* Le journal ne se modifie pas et ne s'efface pas (déclencheurs `audit_log_no_update` et `audit_log_no_delete`). Conservation illimitée. Restaurer une sauvegarde remet le journal de la sauvegarde, puis note la restauration.
* Les réponses aux questionnaires de santé et de consentement ne sont jamais recopiées : seul le fait qu'elles changent est noté.
* Pas de clé étrangère : une entrée survit à la suppression de la fiche.
* Réception d'un lot à usage multiple : une seule entrée pour toutes les pièces (écrite par `lots::add_stock`), pas une par pièce.
* Événements de l'app (entity = app) : protection activée, mot de passe changé, clé de secours renouvelée, Touch ID, verrouillage automatique, dossier de sauvegarde, sauvegarde créée, sauvegarde restaurée, export CSV.
* L'empreinte des sauvegardes ignore les entrées « sauvegarde créée » : une sauvegarde ne compte pas comme un changement à sauvegarder.

Anciennes tables supprimées (migration 010)

Les tables products et session_products, remplacées par lots, units et session_usages depuis la migration 006, sont supprimées. La migration vérifie d'abord que chaque ancienne fiche a son lot et chaque ancien lien son équivalent ; sinon elle s'arrête sans rien supprimer.

Rendez-vous, projets, acomptes et paiements (migration 009)

Session (ajouts)
├── project_id        projet du même client, optionnel
├── start_time        « HH:MM » local, optionnel
├── duration_minutes  15 à 720, exige une heure
├── price_cents       prix convenu
└── status            + NO_SHOW (absent)

Project
├── id, client_id, title, body_area, description
├── quoted_price_cents   prix annoncé de la pièce
├── status               ACTIVE | COMPLETED | ABANDONED
└── created_at, updated_at

Deposit (acompte)        → projet et/ou séance ; montant, mode, date, note ; annulation motivée
DepositOutcome           → APPLIED (séance) | FORFEITED | REFUNDED ; une seule active ; annulation motivée
Payment                  → séance ; montant, mode, date, note ; annulation motivée

* Montants en centimes. Les tables d'argent ne se modifient ni ne s'effacent (triggers) : une erreur s'annule avec un motif.
* Reste à payer = prix − acomptes déduits − paiements.
* La table sessions a été reconstruite (statut NO_SHOW) en gardant les identifiants : tous les liens existants sont conservés.

Titre de séance (migration 017)

Session (ajout)
└── title    libre, optionnel

* Sans projet, la séance garde le titre saisi, ou aucun.
* Avec un projet et sans titre : « {titre du projet} séance N », N = nombre de séances déjà rattachées à ce projet + 1. Le numéro est figé à l'enregistrement.
* Un titre déjà saisi n'est pas recalculé si le projet change ou si le lien est retiré.
* Les séances déjà liées au moment de la migration reçoivent ce titre une fois, numérotées par date puis par création.

Hygiène expliquée (migration 018)

Session (ajout)
└── aftercare_explained    0 ou 1, défaut 0

* La tatoueuse coche qu'elle a expliqué les règles d'hygiène après le tatouage. Le contenu de ces règles n'est pas enregistré.
* Les séances déjà présentes partent décochées. Une séance ou un client archivé refuse le changement.
* Depuis la validation des documents (migration 019), cette case n'est plus à l'écran : la validation la coche, parce que la fiche de soin est notée comme transmise.

Décision sur les documents (migration 019)

Session (ajout)
├── readiness                 FEASIBLE, POSTPONED ou IMPOSSIBLE ; vide tant que ce n'est pas validé
├── readiness_reason          motif, obligatoire pour POSTPONED et IMPOSSIBLE, vide pour FEASIBLE
└── readiness_validated_at    heure UTC, posée une fois

* Réalisable (`FEASIBLE`) : le questionnaire de santé signé et le consentement signé sont joints. Le statut de la séance ne change pas.
* Décaler (`POSTPONED`) : motif obligatoire (document manquant, avis médical, peau irritée…). La séance passe en Reportée.
* Pas possible (`IMPOSSIBLE`) : motif obligatoire. La séance passe en Annulée. L'acompte encore en attente est traité ensuite, comme pour une annulation.
* Une séance terminée refuse le report et l'annulation depuis les documents. Une séance ou un client archivé refuse la validation.
* Le choix, le motif et l'heure ne se réécrivent pas. Le statut de la séance, lui, reste modifiable (une séance reportée peut être replanifiée).

Verrous de traçabilité

* Une séance qui a des produits liés ne change plus de client.
* Un lot utilisé en séance garde son nom, son numéro, sa péremption et sa durée après ouverture.
* La date d'ouverture d'une pièce utilisée en séance ne change plus une fois renseignée. Elle ne peut pas être dans le futur.
* La péremption est calculée en Rust (`services/expiry.rs`), avec la date locale. Pour un produit lié, elle s'évalue à la date de la séance.

⸻

🔎 Traçabilité

Depuis une séance : ses lots et ses flacons.

Depuis un lot : ses séances.

Depuis un client : ses séances, puis les lots et flacons.

⸻

🗃️ Schéma relationnel simplifié

┌──────────────┐
│    CLIENT    │
├──────────────┤
│ id           │
│ first_name   │
│ last_name    │
│ birth_date   │
│ email        │
│ phone        │
│ notes        │
│ created_at   │
│ updated_at   │
└──────┬───────┘
       │
       │ 1:N
       ▼
┌──────────────┐
│   SESSION    │
├──────────────┤
│ id           │
│ client_id    │
│ title        │
│ date         │
│ status       │
│ body_area    │
│ description  │
│ notes        │
│ created_at   │
│ updated_at   │
└──────┬───────┘
       │
       │ N:N
       ▼
┌──────────────────┐
│  SESSION_USAGE   │
├──────────────────┤
│ id               │
│ session_id       │
│ lot_id           │
│ unit_id          │
│ created_at       │
└────────┬─────────┘
         │
         │ N:1
         ▼
┌──────────────────┐
│       LOT        │
├──────────────────┤
│ id               │
│ name             │
│ lot_number       │
│ creation_date    │
│ expiration_date  │
│ single_use       │
│ after_opening_months │
│ product_url      │
│ created_at       │
│ updated_at       │
└────────┬─────────┘
         │
         │ 1:N  (encre seulement)
         ▼
┌──────────────────┐
│       UNIT       │
├──────────────────┤
│ id               │
│ lot_id           │
│ opened_at        │
│ created_at       │
│ updated_at       │
└──────────────────┘

Le stock est une liste de STOCK_MOVEMENT rattachée au lot, et au flacon quand c'est une encre.

Les questionnaires seront liés directement à SESSION :

SESSION
   │
   ├── ConsentQuestionnaire
   │
   └── HealthQuestionnaire

⸻

📈 Évolutions prévues

Le modèle doit permettre d’ajouter progressivement de nouvelles fonctionnalités.

Produits

Plus tard, un lot pourra aussi avoir :

Lot
├── brand
├── reference
├── category
├── supplier
└── ...

⸻

Scanner

À terme, la création manuelle pourra être remplacée ou complétée par un scanner :

Scanner
   ↓
Code-barres / QR / autre identifiant
   ↓
Recherche des informations
   ↓
Création automatique du produit

La structure actuelle ne doit donc pas empêcher l’ajout de cette fonctionnalité.

⸻

Stock

La quantité affichée est la somme des mouvements. Elle n'est jamais écrasée.

Lot
   ↓
StockMovement

Un flacon d'encre a ses propres mouvements, de +1 ou −1.

Types :

PURCHASE
CONSUMPTION
LOSS
EXPIRATION
RETURN
ADJUSTMENT

Usage unique : lier à une séance consomme une quantité. Encre : lier un flacon ne change pas le stock. Le sortir est un mouvement à part. Un lot périmé reste sélectionnable.

⸻

Hygiène / stérilisation

Une future version pourra ajouter des entités dédiées :

Sterilization
HygieneAction
Equipment
SterilizationCycle

Elles ne font volontairement pas partie du modèle initial.

⸻

Documents

Une future version pourra associer des documents :

Client
   ↓
Documents
Session
   ↓
Documents

Cela pourra notamment servir pour :

* consentements signés ;
* questionnaires exportés ;
* documents administratifs ;
* photos ;
* rapports.

⸻

🧠 Principes de conception

1. Commencer petit

La V1 doit uniquement résoudre les besoins fondamentaux :

Clients
Séances
Produits
Traçabilité
Questionnaires

⸻

2. Ne pas anticiper toutes les fonctionnalités

Il ne faut pas créer dès maintenant 30 tables pour des fonctionnalités qui n’existent pas encore.

On ajoutera les fonctionnalités lorsque les besoins seront clairement définis.

⸻

3. Préserver la traçabilité

Les relations entre :

Client
  ↓
Séance
  ↓
Produit
  ↓
Lot

sont importantes et doivent rester fiables.

⸻

4. Les questionnaires appartiennent aux séances

Les réponses peuvent évoluer d’une séance à l’autre.

Il ne faut donc pas simplement stocker un questionnaire global sur le client.

⸻

5. Préparer l’évolution sans la développer

Le système doit pouvoir accueillir plus tard :

* scanner ;
* marques et fournisseurs ;
* inventaire avancé ;
* hygiène ;
* stérilisation ;
* documents ;
* signatures ;
* notifications ;
* statistiques ;
* synchronisation cloud.

Mais ces fonctionnalités ne doivent pas être implémentées dans la V1 tant que leur besoin n’est pas précisément défini.

⸻

🎯 Modèle V1 final

La première version du modèle repose donc sur :

CLIENT
   │
   └──< SESSION
          │
          ├── CONSENT QUESTIONNAIRE
          │
          ├── HEALTH QUESTIONNAIRE
          │
          └──< SESSION_USAGE >── LOT ──< UNIT
                                 │
                                 └──< STOCK_MOVEMENT

Le lot porte le nom, le numéro, la péremption, le type et la durée après ouverture.
Le flacon, seulement pour une encre, porte la date d'ouverture.
Le stock est la somme des mouvements.