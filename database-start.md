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

Un produit représente un produit physique pouvant être utilisé pendant une séance.

Exemples :

* encre ;
* aiguille ;
* cartouche ;
* consommable ;
* autre matériel.

Pour la V1, les produits sont créés manuellement.

La possibilité de scanner automatiquement les produits sera ajoutée ultérieurement.

⸻

Informations V1

Product
├── id
├── name
├── lot_number
├── creation_date
├── opened_at
├── expiration_date
├── after_opening_months
├── single_use
├── product_url
├── created_at
└── updated_at

Champs

Champ	Type conceptuel	Obligatoire	Description
id	UUID / ID	Oui	Identifiant unique
name	TEXT	Oui	Nom du produit
lot_number	TEXT	Oui	Numéro de lot
creation_date	DATE	Non	Date de création/fabrication indiquée sur le produit
opened_at	DATETIME	Non	Date/heure d’ouverture
expiration_date	DATE	Oui	Date de péremption imprimée sur le produit
after_opening_months	INTEGER	Non	Nombre de mois d’utilisation après ouverture
single_use	BOOLEAN	Oui	1 = usage unique (aiguille), 0 = réutilisable (encre)
product_url	TEXT	Non	Lien vers la fiche du produit
created_at	DATETIME	Oui	Date d’ajout dans l’application
updated_at	DATETIME	Oui	Dernière modification

opened_at peut être NULL.

NULL
↓
Produit jamais ouvert
2026-10-08 14:32
↓
Produit ouvert

after_opening_months peut être NULL. NULL signifie qu’il n’y a pas de limite plus courte après ouverture.

Exemple :

```text
expiration_date = 2030-01-01
after_opening_months = 6
opened_at = 2026-10-08
```

La limite utile est la plus proche des deux : ici le 2027-04-08, pas 2030. Tant que `opened_at` est NULL, seule `expiration_date` compte.

⸻

🔗 Produits utilisés pendant une séance

Une séance peut utiliser plusieurs produits.

Un produit peut potentiellement être associé à plusieurs séances.

Cela représente donc une relation N:N.

Session
   │
   ├──── Product
   ├──── Product
   └──── Product

Pour cela, il faudra une table intermédiaire.

SessionProduct
├── session_id
├── product_id
└── created_at

Exemple

Session #123
    │
    ├── Encre noire / LOT-123
    ├── Encre rouge / LOT-456
    └── Cartouche / LOT-789

Cette table constitue la première base de la traçabilité.

⸻

🔎 Traçabilité

La V1 doit permettre de répondre à des questions simples :

Depuis une séance

Quels produits ont été utilisés pendant cette séance ?

Séance
  ↓
SessionProduct
  ↓
Produits

Depuis un produit

Dans quelles séances ce produit a-t-il été utilisé ?

Produit
  ↓
SessionProduct
  ↓
Séances

Depuis un client

Quels produits ont été utilisés pour ce client ?

Client
  ↓
Séances
  ↓
SessionProduct
  ↓
Produits

Cela permettra déjà d’avoir une première vraie traçabilité.

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
│ SESSION_PRODUCT  │
├──────────────────┤
│ session_id       │
│ product_id       │
│ created_at       │
└────────┬─────────┘
         │
         │ N:1
         ▼
┌──────────────────┐
│     PRODUCT      │
├──────────────────┤
│ id               │
│ name             │
│ lot_number       │
│ creation_date    │
│ opened_at        │
│ expiration_date  │
│ after_opening_months │
│ single_use       │
│ product_url      │
│ created_at       │
│ updated_at       │
└──────────────────┘

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

Plus tard, un produit pourra avoir :

Product
├── name
├── brand
├── reference
├── category
├── lot_number
├── creation_date
├── opened_at
├── expiration_date
├── after_opening_months
├── single_use
├── product_url
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

Le stock n’est pas réellement géré dans la V1.

Il pourra être ajouté plus tard avec :

Product
   ↓
StockMovement

Exemples :

PURCHASE
CONSUMPTION
LOSS
EXPIRATION
ADJUSTMENT

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
* stock ;
* fournisseurs ;
* inventaire ;
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
          └──< SESSION_PRODUCT >── PRODUCT
                                      │
                                      ├── name
                                      ├── lot_number
                                      ├── creation_date
                                      ├── opened_at
                                      ├── expiration_date
                                      ├── after_opening_months
                                      ├── single_use
                                      └── product_url

Ce modèle constitue la base de départ de la base SQLite.

Il doit rester suffisamment simple pour permettre une première implémentation rapide, tout en conservant les relations nécessaires à l’évolution future de l’application.