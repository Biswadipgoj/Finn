# Vercel Fix Notes

This zip is meant to be uploaded/imported with files at the repository root, not inside an extra `Finn-main/` folder.

Main corrections:

- Removed Google Sheets backup and cron because it was not required for the main deploy.
- Restored Vercel-safe `next.config.js`; removed local recovery-only `outputFileTracing: false` and experimental worker config.
- Removed `export const dynamic` from client pages.
- Added `vercel.json` with `npm install` and `npm run build`.
- Added Node 20 pin through `engines` and `.nvmrc`.
- Kept `next@14.2.35` and Supabase packages pinned to avoid install drift.

If Vercel still fails, check these first:

1. Environment variables must exist in Vercel, not only in `.env.example`.
2. Supabase SQL must be run before using the app.
3. Vercel Root Directory should be the project root where `package.json` exists.
4. Do not set Output Directory manually; leave it default for Next.js.
