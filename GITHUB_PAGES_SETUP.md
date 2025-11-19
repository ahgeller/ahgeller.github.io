# GitHub Pages Setup Options

You have two options for hosting on GitHub Pages:

## Option 1: Root Domain (Recommended for personal sites)
**URL:** `https://YOUR_USERNAME.github.io`

### Steps:
1. Create a repository named **exactly** `YOUR_USERNAME.github.io` (replace YOUR_USERNAME with your GitHub username)
   - Example: If your username is `ahgeller`, name it `ahgeller.github.io`
2. The site will be available at the root: `https://ahgeller.github.io`
3. No base path needed - the app will automatically detect it's at the root

### Update Configuration:
If using root domain, update `vite.config.ts`:
```typescript
base: process.env.NODE_ENV === 'production' ? '/' : '/',
```

And `src/App.tsx` will automatically use `/` as basename.

## Option 2: Subpath (For project repositories)
**URL:** `https://YOUR_USERNAME.github.io/VolleyBall/`

### Steps:
1. Create a repository named `VolleyBall` (or any name you prefer)
2. The site will be available at: `https://YOUR_USERNAME.github.io/VolleyBall/`
3. Update the base path in `vite.config.ts` to match your repo name

### Current Configuration:
The current setup uses `/VolleyBall/` as the base path. If your repo is named differently, update:
- `vite.config.ts`: Change `/VolleyBall/` to `/[YOUR_REPO_NAME]/`
- `src/App.tsx`: Change `/VolleyBall` to `/[YOUR_REPO_NAME]`

## Which Should You Choose?

- **Root Domain (`username.github.io`)**: Best for personal portfolio sites, single main project
- **Subpath (`username.github.io/VolleyBall/`)**: Best for multiple projects, when you want to keep the repo name as "VolleyBall"

## After Setup:

1. Push your code to GitHub
2. Go to Settings → Pages
3. Select "GitHub Actions" as the source
4. Wait for deployment (check Actions tab)
5. Your site will be live!

The app automatically detects whether it's at root or subpath, so it should work in both cases.

