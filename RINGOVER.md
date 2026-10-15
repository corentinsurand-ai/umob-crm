# Intégration Ringover — téléphonie + IA dans le CRM

Chaque appel Ringover (numéro 04 49 39 29 56) est automatiquement consigné
dans le CRM : activité 📞 dans la timeline de l'entreprise, avec analyse IA
(résumé, sentiment, sujets/objections, score /5, transcription, lien
d'enregistrement). Un appel entrant inconnu crée une fiche Suspect.

## Flux
Ringover (webhook « appel terminé ») → `https://umob-crm.vercel.app/api/ringover`
→ détails + transcription via API Ringover → analyse Mistral → activité dans Supabase.

## Étape 1 — Variables d'environnement Vercel (Settings → Environment Variables, type Config, puis Redeploy)

| Nom | Valeur | Obligatoire |
|---|---|---|
| `SUPABASE_URL` | Project URL Supabase (ex. `https://xxxx.supabase.co`) | ✅ |
| `SUPABASE_SERVICE_ROLE_KEY` | clé `service_role` (Supabase → Settings → API) — SECRÈTE, jamais côté navigateur | ✅ |
| `MISTRAL_API_KEY` | clé API Mistral (console.mistral.ai) — côté serveur cette fois (remplace avantageusement VITE_MISTRAL_API_KEY) | pour l'IA |
| `RINGOVER_API_KEY` | clé API du Dashboard Ringover (Developer → API keys) | pour transcription |
| `RINGOVER_NOS_NUMEROS` | `0449392956` (+ autres numéros séparés par des virgules) | recommandé |

## Étape 2 — Webhook côté Ringover (Dashboard → Developer → Webhooks)

1. URL cible : `https://umob-crm.vercel.app/api/ringover`
2. Événement(s) : appel terminé / call ended (+ appel manqué si proposé).
3. Test : passe un appel entrant d'1-2 min sur le 04 49 39 29 56, puis regarde
   Vercel → projet → Logs : chaque appel y journalise le payload brut
   (« WEBHOOK RINGOVER brut: … »). Ce journal sert à calibrer les vrais formats
   de Ringover (payload + endpoints API). Envoie ce log à Vibe pour ajustement.
4. Vérification côté CRM : recharge une fiche → l'activité 📞 apparaît avec
   l'analyse IA.

## Réglages
- Recording/transcription : activer l'enregistrement des appels dans le
  Dashboard Ringover (Sinon transcription vide — l'appel est quand même consigné).
- RGPD : informer les appelants de l'enregistrement (message d'accueil).
- Anti-doublon : chaque appel porte un `appelId` ; un webhook rejoué ne duplique pas l'activité.
- Concurrence : le CRM recharge l'état à l'ouverture ; une activité créée pendant
  qu'une fiche est ouverte apparaît au rechargement.

## Dépannage
| Symptôme | Cause probable |
|---|---|
| Logs Vercel vides | Webhook mal configuré côté Ringover (URL, événement) |
| « config serveur incomplète » | `SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY` absentes ou Redeploy non fait |
| Appel consigné sans transcription | `RINGOVER_API_KEY` absente, enregistrement désactivé, ou endpoints à calibrer (envoyer le log) |
| Appel consigné sans résumé IA | `MISTRAL_API_KEY` absente côté serveur |
