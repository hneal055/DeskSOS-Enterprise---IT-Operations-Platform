# GitHub Actions CI/CD Workflows

## Overview

Automated testing, building, and deployment pipeline for DeskSOS Enterprise.

## Workflows

### 1. CI Pipeline (`ci.yml`)
**Triggered on:** Push to `main` or `develop`

**Jobs:**
- ✅ **Test** - Runs on Node.js 20.x and 22.x
  - Installs dependencies
  - Runs linter
  - Runs unit tests
  - Runs integration tests
  - Generates coverage report
  - Uploads coverage to Codecov

- ✅ **Code Quality** - ESLint and security checks
  - Runs ESLint
  - Checks npm vulnerabilities

- ✅ **System Validation** - Windows-based checks
  - Validates Node.js version
  - Validates npm version
  - Runs DeskSOS validation script

- ✅ **Deploy Staging** - On `develop` branch
  - Builds application
  - Deploys to staging environment
  - Requires: `STAGING_DEPLOY_KEY`, `STAGING_HOST`

- ✅ **Deploy Production** - On `main` branch
  - Runs all tests
  - Builds application
  - Creates GitHub release
  - Deploys to production
  - Requires: `PROD_DEPLOY_KEY`, `PROD_HOST`

- ✅ **Notifications** - Reports final status

### 2. Pull Request (`pr.yml`)
**Triggered on:** Pull request to `main` or `develop`

**Checks:**
- Runs full test suite
- Generates coverage report
- Comments on PR with results

### 3. Manual Deployment (`deploy.yml`)
**Triggered:** Manual workflow dispatch

**Options:**
- Deploy to staging
- Deploy to production

---

## Setup

### 1. Create GitHub Secrets

Add to **Settings → Secrets and variables → Actions:**

```
STAGING_DEPLOY_KEY    = [SSH key or API token]
STAGING_HOST          = [staging.desksos.local]
PROD_DEPLOY_KEY       = [SSH key or API token]
PROD_HOST             = [api.desksos.local]
```

### 2. Verify Workflows

Check workflow status: **Actions** tab in GitHub

### 3. Monitor Deployments

View deployment logs in **Actions** → Workflow run

---

## Usage

### Trigger CI Pipeline
Push to `main` or `develop` branch:
```bash
git push origin main
```

### Trigger PR Checks
Create a pull request:
```bash
git checkout -b feature/my-feature
git push origin feature/my-feature
# Create PR on GitHub
```

### Manual Deployment
1. Go to **Actions** tab
2. Select **Deployment** workflow
3. Click **Run workflow**
4. Select environment (staging/production)
5. Confirm deployment

---

## Monitoring

### View Workflow Runs
- GitHub Actions tab
- Filter by branch or status
- Click run for details

### Badges

Add to README:
```markdown
![Tests](https://github.com/hneal055/DESKSOS-Desktop-App-/workflows/CI%2FCD%20Pipeline/badge.svg)
```

### Coverage Reports
- Uploads to Codecov
- View at: https://codecov.io/gh/hneal055/DESKSOS-Desktop-App-

---

## Troubleshooting

### Tests Failing
1. Check logs in Actions tab
2. Run locally: `npm test`
3. Review error messages

### Deployment Issues
1. Verify secrets are set
2. Check deployment credentials
3. Review deployment logs

### Coverage Not Uploading
1. Ensure CODECOV_TOKEN is set (optional)
2. Check coverage directory path
3. Verify test:coverage script exists

---

## Next Steps

1. Add environment variables to secrets
2. Configure deployment endpoints
3. Test workflow with PR
4. Monitor production deployments

---

**Last Updated:** 2026-02-25