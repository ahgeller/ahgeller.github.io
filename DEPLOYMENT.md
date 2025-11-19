# GitHub Pages Deployment Guide

This guide will help you deploy this project to GitHub Pages.

## Prerequisites

- A GitHub account
- Git installed on your computer
- Node.js and npm installed

## Step 1: Create a GitHub Repository

1. Go to [GitHub](https://github.com) and sign in
2. Click the "+" icon in the top right corner
3. Select "New repository"
4. Name your repository `VolleyBall` (or any name you prefer - if you use a different name, update the `base` path in `vite.config.ts`)
5. Choose whether to make it public or private
6. **Do NOT** initialize with README, .gitignore, or license (we already have these)
7. Click "Create repository"

## Step 2: Initialize Git and Push to GitHub

Open a terminal in your project directory and run:

```bash
# Initialize git repository
git init

# Add all files
git add .

# Create initial commit
git commit -m "Initial commit"

# Add your GitHub repository as remote (replace YOUR_USERNAME with your GitHub username)
git remote add origin https://github.com/YOUR_USERNAME/VolleyBall.git

# Rename branch to main (if needed)
git branch -M main

# Push to GitHub
git push -u origin main
```

## Step 3: Enable GitHub Pages

1. Go to your repository on GitHub
2. Click on "Settings" tab
3. Scroll down to "Pages" in the left sidebar
4. Under "Source", select "GitHub Actions"
5. The workflow will automatically deploy when you push to the `main` branch

## Step 4: Wait for Deployment

1. Go to the "Actions" tab in your repository
2. You should see a workflow run starting
3. Wait for it to complete (usually takes 2-3 minutes)
4. Once complete, go back to Settings > Pages
5. Your site will be available at: `https://YOUR_USERNAME.github.io/VolleyBall/`

## Updating the Site

Every time you push changes to the `main` branch, GitHub Actions will automatically rebuild and redeploy your site.

```bash
git add .
git commit -m "Your commit message"
git push
```

## Important Notes

- The base path is set to `/VolleyBall/` in `vite.config.ts`. If you change your repository name, update this path.
- The site will be available at `https://YOUR_USERNAME.github.io/VolleyBall/`
- Make sure your repository name matches the base path in the config
- API keys and sensitive data should NOT be committed to the repository (they're stored in localStorage in the browser)

## Troubleshooting

### Build fails
- Check the Actions tab for error messages
- Make sure all dependencies are in `package.json`
- Verify Node.js version is 20 or higher

### Site not loading
- Check that GitHub Pages is enabled and using "GitHub Actions" as the source
- Verify the base path in `vite.config.ts` matches your repository name
- Wait a few minutes after deployment - GitHub Pages can take time to propagate

### 404 errors on routes
- Make sure `BrowserRouter` has the correct `basename` prop
- Check that the base path in `vite.config.ts` is correct

