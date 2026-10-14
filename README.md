# CRM U'mob — version production 🚀

Le CRM U'mob (entreprises, contacts, deals, pipeline) en application web
autonome, multi-appareils, avec connexion sécurisée et base de données en
ligne (Supabase). C'est le même CRM que la démo, mais cette fois **tes
données sont enregistrées en ligne** : tu peux y accéder depuis ton
téléphone, ton PC, et plus tard inviter tes commerciaux.

- **Coût : 0 €** (Supabase gratuit + Vercel gratuit + GitHub gratuit)
- **Temps de mise en place : ~20 minutes** (une seule fois)
- **Maintenance : rien** — tout est automatique

---

## 📋 Ce dont tu as besoin (crée les 3 comptes gratuits, 5 min)

1. Un compte **GitHub** (c'est là que vit le code du CRM)
2. Un compte **Supabase** → https://supabase.com (c'est la base de données)
3. Un compte **Vercel** → https://vercel.com (c'est ce qui met le CRM en ligne)

---

## 🗄️ Étape 1 — Créer la base de données (Supabase, ~8 min)

1. Va sur https://supabase.com → **Start your project** → connecte-toi avec GitHub.
2. Clique **New project** :
   - **Name** : `umob-crm`
   - **Database Password** : choisis un mot de passe et garde-le (ça ne servira
     presque jamais, mais note-le quelque part).
   - **Region** : closest to your users (Europe de l'Ouest).
3. Attends ~2 minutes que le projet soit prêt.
4. Dans le menu de gauche, clique **SQL Editor** → bouton **New query**.
5. Ouvre le fichier **`supabase/schema.sql`** de ce projet, copie TOUT son
   contenu, colle-le dans la fenêtre SQL, puis clique **Run**.
   → Le message `Success. No rows returned` doit s'afficher. ✅
6. Crée ton compte utilisateur : menu gauche **Authentication** → **Users** →
   **Add user** → **Create new user** :
   - **Email** : ton adresse e-mail pro
   - **Password** : ton mot de passe de connexion au CRM
   - ✅ coche **Auto Confirm User**
   → Clique **Create user**.
7. **Important (sécurité)** : dans Authentication → **Sign Up / Providers** →
   Email → **désactive** « Allow new users to sign up » et Save. Comme ça,
   personne d'autre ne peut créer un compte — seul toi (et les comptes que
   tu ajoutes à l'étape 2.6) pouvez entrer.

> Plus tard, pour inviter un commercial : Authentication → Users → Add user,
> puis réactive son accès. C'est tout.

## 🔑 Étape 2 — Récupérer les 2 clés de connexion (~2 min)

Toujours dans Supabase :

1. Menu gauche **Project Settings** (⚙️) → **API**.
2. Copie les 2 valeurs :
   - **Project URL** (ressemble à `https://xxxxx.supabase.co`)
   - **anon public** (une longue clé qui commence par `eyJ...`)

Ce sont des clés **publiques par design** : la protection des données repose
sur les règles de sécurité installées à l'étape 1.5, pas sur le secret de ces
clés. Tu peux les coller dans Vercel sans risque.

## 🌐 Étape 3 — Mettre le CRM en ligne (Vercel, ~5 min)

1. Va sur https://vercel.com → **Continue with GitHub**.
2. Clique **Add New** → **Project**.
3. Dans la liste, trouve le dépôt **umob-crm** → **Import**.
4. Avant de cliquer Deploy, ouvre **Environment Variables** et ajoute les 2
   variables (noms à respecter à la lettre) :

   | Name | Value |
   |---|---|
   | `VITE_SUPABASE_URL` | ton Project URL de l'étape 2 |
   | `VITE_SUPABASE_ANON_KEY` | ta clé anon public de l'étape 2 |

5. Clique **Deploy** → attends 1-2 minutes.
6. Clique sur l'URL du site (ex. `umob-crm-xxxx.vercel.app`) → bookmark-la,
   c'est l'adresse de TON CRM. 🎉

> Pour une jolie adresse : Vercel → Settings → **Domains** → tu pourras
> brancher un domaine acheté (ex. `crm.umob.fr`) plus tard.

## 🚀 Étape 4 — Première utilisation

1. Ouvre l'adresse Vercel → écran de connexion → ton e-mail + mot de passe
   (créés à l'étape 1.6).
2. Au premier lancement, le CRM propose :
   - **📥 Importer les 50 clients réels** : contrats Locam, flotte, risques
     SAV, 51 contacts — tout ce qui vient du Sheet « Infos Service Client ».
   - **🆕 Partir de zéro**.
   Les deux sont valables ; l'import peut aussi être fait plus tard.
3. L'indicateur en bas de la barre latérale affiche l'état de la
   synchronisation : ✅ tout est enregistré automatiquement à chaque
   modification.

## 🛠️ Pour un développeur (optionnel) — lancer le CRM en local

```bash
npm install
cp .env.example .env   # puis remplir les 2 valeurs (étape 2)
npm run dev            # → http://localhost:5173
```

## 🩺 Dépannage

| Problème | Solution |
|---|---|
| Écran « Configuration manquante » | Les variables `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` sont absentes dans Vercel (étape 3.4) — vérifie les noms, sans espace, puis **Redeploy**. |
| « Impossible de charger le CRM » | Le schéma SQL n'a pas été exécuté (étape 1.5) ou la variable URL est fausse. |
| « E-mail ou mot de passe incorrect » | Vérifie le compte créé en 1.6 (Authentication → Users). |
| Le site affiche une erreur 404 | Chez Vercel : Settings → Domaines — utilise bien l'URL `.vercel.app` fournie. |

---

## 🗺️ Roadmap (déjà prévue dans l'architecture)

1. **Import Sellsy** : zone de quarantaine + comparaison + validation humaine
   (jamais d'import direct en base — règle « zéro info fausse »).
2. **Aircall** : appels + transcription + résumé auto dans les fiches.
3. **Brief du matin IA** : ce que chaque commercial a fait la veille.
4. **Vue équipe** : le poste de commandement manager.

*Application générée le 14/10/2026 par Vibe à partir du CRM démo validé.*
