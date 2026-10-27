# 📥 Demandes entrantes : e-mails → CRM

Les e-mails de prospects reçus sur la boîte OVH (transférés depuis la boîte
« contact ») arrivent **automatiquement dans le CRM**, en **quarantaine** :
rien n'entre dans la base sans validation humaine (règle anti-invention).

## 1. Table Supabase (2 min, une seule fois)

Ouvre https://supabase.com → ton projet → **SQL Editor** → **New query** →
colle le contenu de `supabase/arrivees.sql` → **Run**.

## 2. Secret de l'API (2 min, une seule fois)

1. Génère un secret (ex. dans ton terminal : `openssl rand -hex 16`)
2. Vercel → projet **umob-crm** → **Settings** → **Environment Variables** :
   - Name : `INBOUND_EMAIL_SECRET`
   - Value : ton secret — type **Config**
3. **Redeploy** le projet (toute nouvelle variable exige un redeploy).

## 3. Scénario Make (10 min, une seule fois)

1. Crée un compte sur make.com (offre gratuite : 1 000 opérations/mois)
2. **Create a new scenario**, modules :
   - **Email › Watch Emails** (IMAP) : serveur `ssl0.ovh.net` port 993,
     identifiants de la boîte OVH, dossier INBOX, « watch only unread »
   - (optionnel) **Filter** : ne garder que les e-mails entrants pertinents
     (ex. ne pas traiter les notifications, spams, newsletters)
   - **HTTP › Make a request** :
     - URL : `https://umob-crm.vercel.app/api/inbound-email?secret=TON_SECRET`
     - Method : POST, Type de corps : JSON
     - Body (mapper les variables du module e-mail) :
       `{"messageId": "{{messageId}}", "from": "{{fromEmail}}", "fromName": "{{fromName}}", "subject": "{{subject}}", "text": "{{text}}", "html": "{{html}}", "date": "{{date}}"}`
3. **Schedule** : toutes les 15 minutes (offre gratuite Make)
4. Active le scénario (bouton ON). Envoie-toi un e-mail test depuis une
   autre adresse → il doit apparaître dans le CRM, vue **📥 Entrantes**.

## 4. Dans le CRM

- La sidebar affiche **📥 Entrantes** avec un badge rouge (nombre en attente)
- Chaque carte montre : expéditeur, sujet, message complet, et ce que l'IA
  a extrait (société, ville, secteur, téléphone, contact, besoin)
- Si le numéro / contact existe déjà : bandeau orange — l'e-mail sera
  **consigné sur la fiche existante** (jamais de doublon)
- **✅ Créer la fiche Suspect** (ou consigner sur la fiche existante) ou
  **🗑 Ignorer** (supprime l'entrée de la quarantaine)

## Diagnostic

Ouvre `https://umob-crm.vercel.app/api/inbound-email` : les variables
serveur doivent toutes être à `true`.
