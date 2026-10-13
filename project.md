# 🖋️ Tattoo Manager

Application desktop destinée à aider les tatoueurs/tatoueuses à gérer leur activité au quotidien.

L'objectif est de centraliser au même endroit :

- 👥 Les clients
- 📅 Les rendez-vous
- 📝 Les séances de tatouage
- 📦 Le stock
- 🧴 Les produits et consommables
- 🧪 La traçabilité des produits utilisés
- 🧼 L'hygiène et la stérilisation
- 📋 L'ouverture et l'utilisation des produits
- 📄 Les documents et consentements
- 📸 Les photos et fichiers liés aux clients
- 📊 Les statistiques et rapports
- 💾 Les sauvegardes

> **Important :** l'architecture et les fonctionnalités décrites ici constituent une base de départ. Le projet est amené à évoluer en fonction des besoins réels de la tatoueuse et des contraintes réglementaires.

> **Modèle V1 :** le premier schéma SQLite est défini dans `database-start.md` : clients, séances, produits, liens séance–produit, questionnaires de séance. Le stock, les lots séparés, l'hygiène, les documents, les photos et les rendez-vous décrits plus bas sont des évolutions, pas des tables de départ.

---



# 🎯 Objectifs

L'application doit être :

- **simple** à utiliser au quotidien ;
- **rapide**, même avec beaucoup de données ;
- **fiable** pour la traçabilité ;
- **offline-first**, afin de fonctionner sans connexion Internet ;
- **sécurisée**, notamment concernant les données personnelles ;
- **maintenable**, afin de pouvoir faire évoluer l'application sans devoir tout réécrire ;
- **évolutive**, avec la possibilité d'ajouter plus tard une synchronisation cloud ou plusieurs postes.

L'application est pensée en priorité pour un usage **desktop**.

---



# 🏗️ Stack technique



## Desktop



### Tauri 2

Tauri est utilisé comme framework desktop.

Il permet de créer une application native à partir d'un frontend web tout en gardant une empreinte beaucoup plus légère qu'une application Electron classique.

Tauri permet notamment :

- de créer des applications Windows / macOS / Linux ;
- d'accéder au système de fichiers ;
- de communiquer avec Rust ;
- de gérer les fenêtres et le cycle de vie de l'application ;
- de distribuer l'application sous forme d'installateur.

---



# 🎨 Frontend



## React

React sera utilisé pour construire l'interface utilisateur.

Il est particulièrement adapté au projet car l'application sera composée de nombreuses interfaces métier :

- tableaux ;
- formulaires ;
- fiches clients ;
- tableaux de stock ;
- historiques ;
- dashboards ;
- fenêtres modales ;
- filtres ;
- recherches ;
- formulaires complexes.

---



## TypeScript

TypeScript sera utilisé partout côté frontend.

Objectifs :

- éviter les erreurs de typage ;
- avoir une meilleure autocomplétion ;
- faciliter la maintenance ;
- définir clairement les modèles de données ;
- sécuriser les échanges avec le backend Rust.

---



## Vite

Vite sera utilisé comme outil de build et de développement pour React.

### Pourquoi Vite ?

Contrairement à Next.js, l'application n'a pas besoin de :

- SSR ;
- Server Components ;
- API Routes ;
- backend Node ;
- génération de pages côté serveur.

L'application est une application desktop Tauri.

L'architecture frontend sera donc simplement :

```text
React
  ↓
Vite
  ↓
Tauri
```

Cela permet de rester simple et rapide.

---



# 🎨 UI



## Tailwind CSS

Tailwind CSS sera utilisé pour construire l'interface.

Il permet notamment :

- de construire rapidement les interfaces ;
- d'avoir une cohérence visuelle ;
- de créer facilement des layouts responsives ;
- d'éviter de multiplier les fichiers CSS.

---



## Composants

L'interface utilise des composants React propres au projet, stylés avec Tailwind.

Les composants réutilisables vivent dans `src/components/`. On les écrit quand un écran en a besoin : bouton, champ, dialogue, tableau. Pas de bibliothèque de composants à installer en amont.

---



# 🧠 Gestion de l'état



## Zustand

Zustand pourra être utilisé pour l'état global de l'application.

Exemples :

```text
UserStore
SettingsStore
UIStore
SessionStore
```

Il ne faut cependant pas utiliser Zustand pour stocker toutes les données de l'application.

Les données métier doivent rester dans la base SQLite.

---



# 🦀 Backend



## Rust

Rust sera utilisé avec Tauri pour toute la partie backend locale.

Il sera notamment responsable de :

- l'accès à SQLite ;
- les requêtes complexes ;
- la gestion des fichiers ;
- les sauvegardes ;
- les imports/exports ;
- la génération de documents ;
- certaines validations ;
- la logique métier sensible ;
- les opérations nécessitant des permissions système.

Le frontend communiquera avec Rust via les commandes Tauri.

Exemple conceptuel :

```text
React
  │
  │ invoke("get_client")
  ▼
Tauri / Rust
  │
  ▼
SQLite
```

---



# 🗄️ Base de données



## SQLite

SQLite sera la base de données principale pour la première version.

### Pourquoi SQLite ?

L'application est avant tout une application desktop locale.

SQLite permet :

- de fonctionner sans serveur ;
- de fonctionner hors ligne ;
- d'avoir une excellente vitesse ;
- d'avoir une base dans un seul fichier ;
- de simplifier considérablement le déploiement ;
- de faciliter les sauvegardes.

Exemple :

```text
application/
├── database.sqlite
├── files/
├── photos/
└── backups/
```

---



# 🧩 Accès à la base de données



## SQLx

SQLx pourra être utilisé côté Rust pour communiquer avec SQLite.

Il permettra notamment :

- des requêtes SQL explicites ;
- des migrations ;
- du typage ;
- une meilleure maîtrise de la base de données.

Le choix de SQLx pourra évoluer si les besoins du projet changent.

---



# 🔄 Migrations

La base de données doit être versionnée grâce à des migrations.

Exemple :

```text
migrations/
├── 001_clients.sql
├── 002_sessions.sql
├── 003_products.sql
├── 004_session_products.sql
└── ...
```

Une migration ne doit jamais modifier silencieusement les anciennes données.

Les évolutions de la structure doivent être traçables.

---



# 🧱 Architecture générale

L'architecture initiale sera proche de :

```text
┌────────────────────────────────────────────┐
│                 TAURI 2                    │
│                                            │
│  ┌──────────────────────────────────────┐  │
│  │            React / TypeScript        │  │
│  │                                      │  │
│  │ Dashboard                            │  │
│  │ Clients                              │  │
│  │ Rendez-vous                          │  │
│  │ Séances                              │  │
│  │ Stock                                │  │
│  │ Produits                             │  │
│  │ Hygiène                              │  │
│  │ Stérilisation                        │  │
│  │ Documents                            │  │
│  │ Paramètres                           │  │
│  └─────────────────┬────────────────────┘  │
│                    │                       │
│              Tauri Commands               │
│                    │                       │
│  ┌─────────────────▼────────────────────┐  │
│  │                 Rust                 │  │
│  │                                      │  │
│  │ Business Logic                       │  │
│  │ Database                             │  │
│  │ Files                                │  │
│  │ Backup                               │  │
│  │ PDF                                  │  │
│  └─────────────────┬────────────────────┘  │
│                    │                       │
│              ┌─────▼─────┐                 │
│              │  SQLite   │                 │
│              └───────────┘                 │
└────────────────────────────────────────────┘
```

---



# 📁 Organisation du projet

Une organisation possible :

```text
tattoo-manager/
│
├── src/
│   ├── components/
│   ├── features/
│   │   ├── clients/
│   │   ├── appointments/
│   │   ├── sessions/
│   │   ├── inventory/
│   │   ├── hygiene/
│   │   ├── sterilization/
│   │   ├── products/
│   │   └── reports/
│   │
│   ├── stores/
│   ├── lib/
│   ├── hooks/
│   ├── routes/
│   └── App.tsx
│
├── src-tauri/
│   ├── src/
│   │   ├── commands/
│   │   ├── database/
│   │   ├── models/
│   │   ├── services/
│   │   └── main.rs
│   │
│   └── migrations/
│
├── public/
│
├── package.json
├── vite.config.ts
└── README.md
```

Cette organisation n'est pas définitive.

Elle pourra évoluer lorsque le projet deviendra plus important.

La V1 ne crée que les features `clients`, `sessions` et `products`. Les autres dossiers arrivent avec les évolutions.

---



# 👥 Gestion des clients

En V1, un client a :

```text
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
```

`first_name` et `last_name` sont obligatoires. Le reste des champs métier est optionnel.

Rendez-vous, documents, photos et consentements globaux ne sont pas sur le client en V1. Les questionnaires appartiennent à la séance.

---



# 📅 Rendez-vous

Hors V1. Le statut `PLANNED` d'une séance suffit pour commencer.

Le système pourra gérer plus tard :

- les rendez-vous ;
- les créneaux ;
- les statuts ;
- les notes ;
- les séances associées ;
- les rappels éventuels.

La gestion du calendrier pourra évoluer indépendamment du reste de l'application.

---



# 🖋️ Séances de tatouage

Une séance représente une prestation réalisée pour un client. Elle appartient à un seul client.

```text
Session
├── id
├── client_id
├── date
├── status          PLANNED | COMPLETED | CANCELLED | RESCHEDULED
├── body_area
├── description
├── notes
├── created_at
└── updated_at
```

Les produits utilisés passent par `session_products`. Les questionnaires de consentement et de santé sont liés à la séance, pas au client. Leurs champs seront ajoutés quand le contenu sera connu.

Photos et documents associés viendront plus tard.

---



# 📦 Produits

En V1, un produit est saisi à la main. Le lot est une colonne, pas une table. Il n'y a pas de quantité ni de stock.

```text
Product
├── id
├── name
├── lot_number
├── creation_date
├── opened_at               NULL = jamais ouvert
├── expiration_date
├── after_opening_months    NULL = pas de limite plus courte après ouverture
├── single_use              1 = usage unique, 0 = réutilisable
├── product_url
├── created_at
└── updated_at
```

`name`, `lot_number`, `expiration_date` et `single_use` sont obligatoires.

`after_opening_months` est un nombre de mois, pas une date. Une encre peut se périmer en 2030 et n'être bonne que 6 mois après ouverture : la limite utile est la plus proche entre `expiration_date` et `opened_at` plus ces mois. Tant que le produit n'est pas ouvert, seule `expiration_date` compte.

Une séance utilise plusieurs produits, et un produit peut servir plusieurs séances :

```text
SessionProduct
├── session_id
├── product_id
└── created_at
```



## Évolution — stock

Le stock n'est pas dans la V1. Il pourra gérer plus tard différents types de produits :

- encres ;
- aiguilles/cartouches ;
- gants ;
- produits d'hygiène ;
- consommables ;
- matériel stérile ;
- produits désinfectants ;
- autres fournitures.

Chaque produit pourra éventuellement avoir, en plus des champs V1 :

```text
Produit
├── Marque
├── Référence
├── Catégorie
├── Fournisseur
├── Date d'achat
├── Quantité
└── Emplacement
```

Ces informations sont susceptibles d'évoluer. La quantité, le jour où elle existera, passera par des mouvements de stock, pas par un écrasement.

---



# 🔎 Traçabilité

La traçabilité V1 passe par `session_products` et par `products.lot_number`.

```text
Client → Séances → SessionProduct → Produits
Produit → SessionProduct → Séances
Séance → SessionProduct → Produits
```

Exemples :

> Quels produits ont été utilisés pendant cette séance ?

> Dans quelles séances le produit de lot `ABC123` a-t-il été utilisé ?

> Quels produits ont été utilisés pour ce client ?

---



# 📊 Mouvements de stock

Hors V1. Quand le stock existera, il faudra enregistrer un mouvement plutôt que d'écraser une quantité.

Exemple :

```text
Stock = 20
```

Puis :

```text
Stock = 19
```

Il est préférable d'enregistrer un mouvement :

```text
StockMovement

product_id
lot_id
type
quantity
date
session_id
reason
```

Exemples de mouvements :

```text
PURCHASE
ADJUSTMENT
CONSUMPTION
EXPIRATION
LOSS
RETURN
```

Cela permet de conserver un historique.

---



# 🧼 Hygiène et stérilisation

Hors V1. Une partie spécifique pourra gérer plus tard les opérations liées à l'hygiène.

Exemples potentiels :

- opérations de nettoyage ;
- désinfection ;
- stérilisation ;
- matériel ;
- cycles ;
- dates ;
- opérateur ;
- lots ;
- contrôles ;
- observations ;
- historique.

**Attention :**

La structure définitive de cette partie devra être conçue à partir des procédures réellement utilisées par la tatoueuse et des obligations réglementaires applicables.

L'application ne doit pas inventer de règles sanitaires.

---



# 🧴 Ouverture des produits

En V1, l'ouverture est le champ `products.opened_at`. Une table d'ouvertures séparée n'est pas nécessaire.

Plus tard, l'application pourra enregistrer des ouvertures plus détaillées.

Exemple :

```text
ProductOpening
├── Product
├── Lot
├── Date d'ouverture
├── Heure
├── Séance
├── Client
├── Quantité
├── Date limite éventuelle
└── Notes
```

L'objectif est de pouvoir retrouver précisément l'utilisation d'un produit.

---



# 📸 Fichiers et photos

Les fichiers ne devraient pas forcément être stockés directement dans SQLite.

La base pourrait stocker uniquement les métadonnées :

```text
Document
├── id
├── type
├── filename
├── path
├── client_id
├── session_id
└── created_at
```

Les fichiers seraient stockés dans un répertoire dédié.

```text
data/
├── database.sqlite
├── photos/
├── documents/
└── backups/
```

---



# 💾 Sauvegardes

Les sauvegardes seront importantes puisque l'application est locale.

La V1 devrait prévoir au minimum :

- sauvegarde manuelle ;
- restauration ;
- export de données ;
- éventuellement sauvegarde automatique.

Une évolution possible serait :

```text
Local SQLite
      ↓
Backup automatique
      ↓
Disque externe / Cloud
```

---



# 🔐 Sécurité et confidentialité

L'application pourra contenir des données personnelles sensibles.

Il faudra donc prévoir progressivement :

- contrôle d'accès ;
- verrouillage de l'application ;
- protection des fichiers ;
- sauvegardes sécurisées ;
- limitation des données stockées ;
- journalisation des opérations importantes.

Les choix définitifs dépendront notamment des besoins réels et du cadre réglementaire applicable.

---



# 🌐 Pas de cloud en V1

La première version doit rester locale.

```text
┌──────────────┐
│ Tauri        │
│              │
│ React        │
│ Rust         │
│ SQLite       │
└──────────────┘
```

Il n'est pas nécessaire d'avoir :

- serveur Node ;
- API REST ;
- PostgreSQL distant ;
- Docker ;
- infrastructure cloud.

Cela réduit énormément la complexité initiale.

---



# ☁️ Évolution possible vers le cloud

Si les besoins évoluent, une architecture cloud pourra être ajoutée.

Par exemple :

```text
             Cloud
        ┌──────────────┐
        │ PostgreSQL   │
        │ Auth         │
        │ Storage      │
        └──────┬───────┘
               │
        Synchronisation
               │
       ┌───────┴───────┐
       │               │
    Ordinateur      Ordinateur
       A               B
     SQLite          SQLite
```

Cette évolution n'est pas nécessaire pour la V1.

---



# 🧪 Tests



## Frontend

```text
Vitest
```

Pour tester :

- fonctions ;
- logique métier frontend ;
- stores ;
- composants.



## End-to-end

```text
Playwright
```

Pour tester les parcours importants :

```text
Créer un client
        ↓
Créer une séance
        ↓
Ajouter un produit
        ↓
Lier le produit à la séance
        ↓
Consulter la traçabilité
```



## Backend

Rust devra également disposer de tests unitaires et d'intégration.

---



# 🛠️ Qualité du code

Le projet utilisera notamment :

```text
ESLint
Prettier
TypeScript strict
Rust fmt
Rust clippy
```

L'objectif est de garder une base de code propre au fur et à mesure que l'application grandit.

---



# 🚀 CI/CD

GitHub Actions pourra être utilisé pour automatiser :

```text
Push
 ↓
Tests
 ↓
Lint
 ↓
Build
 ↓
Package Tauri
 ↓
Release
```

Les builds pourront ensuite générer les installateurs correspondant aux différents systèmes.

---



# 📦 Gestion des dépendances

Le frontend pourra utiliser :

```text
pnpm
```

Le backend utilisera :

```text
Cargo
```

Il faut éviter d'ajouter des dépendances sans réel besoin.

Chaque dépendance doit avoir une justification.

---



# 🗺️ Roadmap initiale

La roadmap est indicative et pourra changer.

## Phase 1 — Fondation

- [x] Initialisation Tauri
- [x] React + TypeScript
- [x] Vite
- [x] Tailwind
- [x] SQLite
- [x] Migrations
- [x] Architecture Rust
- [x] Système de configuration



## Phase 2 — Clients

- [x] Liste des clients
- [x] Création
- [x] Modification
- [x] Recherche
- [x] Fiche client



## Phase 3 — Séances

- [x] Création d'une séance
- [x] Statuts `PLANNED`, `COMPLETED`, `CANCELLED`, `RESCHEDULED`
- [x] Notes
- [x] Lien avec le client



## Phase 4 — Produits et traçabilité

- [x] Produits (`name`, `lot_number`, `expiration_date`, `opened_at`, `after_opening_months`, `single_use`, `product_url`)
- [x] Lien `session_products`
- [x] Produits d'une séance
- [x] Séances d'un produit
- [x] Produits d'un client



## Phase 5 — Questionnaires

- [ ] Questionnaire de consentement, lié à la séance
- [ ] Questionnaire de santé, lié à la séance
- [ ] Saisie ou import manuel
- [ ] Export



## Phase 6 — Évolutions métier

- [ ] Rendez-vous
- [ ] Stock et mouvements
- [ ] Lots séparés, marques, fournisseurs
- [ ] Hygiène et stérilisation
- [ ] Documents et photos
- [ ] Rapports



## Phase 7 — Sauvegardes

- [ ] Backup manuel
- [ ] Restauration
- [ ] Export
- [ ] Backup automatique



## Phase 8 — Évolutions techniques

Potentiellement :

- [ ] Synchronisation cloud
- [ ] Plusieurs ordinateurs
- [ ] Comptes utilisateurs
- [ ] Statistiques avancées
- [ ] Notifications
- [ ] Application mobile
- [ ] Intégrations externes

---



# 🧠 Principes importants



## 1. Ne pas sur-engineerer

La première version doit rester simple.

Pas de serveur ou d'infrastructure complexe si le besoin n'existe pas.

---



## 2. La base de données doit être pensée avant l'UI

Les relations V1 entre :

```text
Client
 ↓
Séance
 ↓
SessionProduct
 ↓
Produit (lot_number)
```

doivent être cohérentes avant de construire toutes les interfaces. Le détail est dans `database-start.md`.

---



## 3. Ne jamais détruire inutilement l'historique

Pour la traçabilité V1, conserver les lignes de `session_products`. Ne pas les effacer pour « corriger » une séance.

Quand le stock existera, privilégier des mouvements plutôt qu'une quantité écrasée.

---



## 4. Séparer l'interface de la logique métier

Éviter de mettre toute la logique directement dans React.

Le frontend doit principalement gérer :

```text
Interface
 ↓
Interaction
 ↓
Tauri command
 ↓
Business logic
 ↓
Database
```

---



## 5. Prévoir l'évolution

Les décisions prises aujourd'hui ne doivent pas empêcher :

- le cloud ;
- plusieurs utilisateurs ;
- plusieurs ordinateurs ;
- la synchronisation ;
- de nouvelles fonctionnalités.

Mais ces fonctionnalités ne doivent pas être développées prématurément.

---



# 📌 Stack récapitulative

```text
Desktop
└── Tauri 2

Frontend
├── React
├── TypeScript
├── Vite
├── Tailwind CSS
└── Zustand

Backend
└── Rust

Database
├── SQLite
└── SQLx

Tests
├── Vitest
├── Playwright
└── Rust tests

Tooling
├── pnpm
├── Cargo
├── ESLint
├── Prettier
└── GitHub Actions
```

---



# ⚠️ À garder en tête

Ce projet peut gérer des informations personnelles et des données liées à l'activité professionnelle.

Les fonctionnalités concernant :

- les données clients ;
- les consentements ;
- l'hygiène ;
- la stérilisation ;
- la traçabilité ;
- les durées de conservation ;
- les documents ;

devront être validées en fonction des besoins réels et des réglementations applicables.

L'application est un **outil de gestion et de traçabilité**. Elle ne doit pas être considérée comme une source juridique ou sanitaire en elle-même.

---



# 🎯 Vision

L'objectif final est d'obtenir une application desktop simple et agréable :

```text
┌──────────────────────────────────────┐
│           TATTOO MANAGER             │
├────────────┬─────────────────────────┤
│            │                         │
│ Dashboard  │  Aujourd'hui            │
│ Clients    │                         │
│ Planning   │  📅 Rendez-vous         │
│ Séances    │  👥 Clients             │
│ Stock      │  📦 Alertes stock       │
│ Hygiène    │  ⚠️ Produits expirant   │
│ Documents  │  🧼 Hygiène             │
│ Rapports   │                         │
│ Paramètres │                         │
│            │                         │
└────────────┴─────────────────────────┘
```

L'application doit avant tout **faire gagner du temps à la tatoueuse**, tout en fournissant une traçabilité claire et exploitable.

Les choix techniques présents dans ce document constituent une **base de départ** et pourront évoluer avec le projet.