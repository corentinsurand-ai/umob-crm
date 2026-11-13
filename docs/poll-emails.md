# Poller IMAP demandes entrantes

Voir api/poll-emails.ts. Cron cron-job.org toutes les 2 min : GET /api/poll-emails?secret=…

- 1er run : rattrapage SINCE POLL_DEPUIS (défaut 1-Nov-2026)
- puis reprise par UID (table crm_poll_etat, id=imap)
- push parallèle vers /api/inbound-email (classification IA + quarantaine crm_arrivees)
- POLL_MAX mails par run (défaut 8, env Vercel)
- diagnostic : GET /api/poll-emails?config=1
