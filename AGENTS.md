## Deploy Configuration (configured by /setup-deploy)
- Platform: Railway
- Production URL: https://orchard-server-production.up.railway.app
- Deploy workflow: auto-deploy on push to main
- Deploy status command: HTTP health check at https://orchard-server-production.up.railway.app/health
- Merge method: squash
- Project type: web app/API
- Post-deploy health check: https://orchard-server-production.up.railway.app/health

### Custom deploy hooks
- Pre-merge: npm test -- --runInBand
- Deploy trigger: automatic on merge to main
- Deploy status: poll production /health URL
- Health check: https://orchard-server-production.up.railway.app/health
