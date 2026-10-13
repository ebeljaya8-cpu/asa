# Project Rules: Clanker Gecko Bot

## Automatic Deployment & Push Workflow
Setiap kali ada perubahan, update fitur, perbaikan bug, atau penambahan kode pada project ini:
1. **Otomatis Git Commit & Push:**
   - Selalu lakukan `git add .` (atau file yang terkait).
   - Lakukan commit dengan pesan deskriptif: `git commit -m "..."`.
   - Lakukan `git push origin main` secara otomatis agar Railway langsung mendeteksi perubahan dan melakukan redeploy container secara instan tanpa perlu menunggu instruksi manual.
2. **Kerahasiaan Kunci & Data:**
   - Jangan pernah melakukan commit file `.env` atau credential private key.
