# REVREBEL label automation

## Canonical GitHub label catalog

The root labels.yml defines GitHub issue/PR label names. The organization-level workflow .github/workflows/labels-sync.yml reconciles that catalog into all REVREBEL repositories accessible to the revrebel-github App with Issues enabled. It creates missing labels, updates matching label colors/descriptions, and never deletes unrelated labels.

## Required GitHub Actions configuration

In REVREBEL/.github repository Actions settings (or accessible organization-level settings), create:
- Variable REVREBEL_GITHUB_APP_ID: numeric App ID for revrebel-github.
- Secret REVREBEL_GITHUB_APP_PRIVATE_KEY: PEM private key, including the BEGIN and END lines.

Install the GitHub App on desired repositories, with Issues: Read & write. The workflow mints a short-lived installation token and validates the revrebel-github App slug before modifying labels. The ordinary GITHUB_TOKEN cannot administer labels in unrelated repositories.

Never commit the private key. Installing the App alone does not supply the Actions workflow with an App ID or private key.

## Triggers and safety

- PR changes run parser/reconciliation tests without authentication or writes.
- Manual workflow_dispatch starts in dry-run mode. Choose apply=true to write labels. Optionally specify repository=REVREBEL/linear-agents for a limited rollout.
- Push to main touching labels or the sync workflow automatically reconciles the installed repositories.
- Weekly schedule catches drift.
- Disabled, archived, and Issues-disabled repositories are skipped.
- Existing unrelated labels are preserved. API errors fail the job with a per-repository report.

Start with manual dry-run, then apply to REVREBEL/linear-agents, then the entire installation.

## PR labels

The organization repository's PR labeler workflow reads the root labeler.yml and applies canonical names (type: documentation, type: maintenance, dev-area: backend, etc.) only for PRs in the repository where that workflow runs.

Unlike the label catalog sync, the PR labeler does not execute in every org repository automatically: each target repository needs its own trigger/caller. Linear's grouped issue labels and Agent Location routing are independent of this GitHub catalog synchronization.
