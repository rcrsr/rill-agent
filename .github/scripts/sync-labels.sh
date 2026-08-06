#!/usr/bin/env bash
# Creates or updates the rill-agent label taxonomy (the label axes only).
# Types (Bug/Feature/Chore/Security/Idea) and Priority are native org-level
# GitHub fields, not labels, and are configured in org settings, not here.
#
# One signal per axis; label text is the load-bearing distinction (WCAG 1.4.1).
# area:* uniform blue; on-hold gray (parked); needs-triage yellow (pending).
#
# Usage: .github/scripts/sync-labels.sh            (defaults to rcrsr/rill-agent)
#        REPO=owner/name .github/scripts/sync-labels.sh
#
# Idempotent: `gh label create --force` upserts, so re-running only updates
# color/description drift. Requires: gh, authenticated with repo scope.
set -euo pipefail

REPO="${REPO:-rcrsr/rill-agent}"

AREA_COLOR="1d76db"   # blue, uniform across every area
HOLD_COLOR="d2dae1"   # gray, parked/inactive
TRIAGE_COLOR="fbca04" # yellow, pending/triage

declare -a AREAS=(
  "area:core|manifest loader, AgentRouter, validateParams, routerErrorToStatus"
  "area:http|the Hono HTTP harness"
  "area:foundry|the Foundry Responses API harness, sessions, conversations, OTEL"
  "area:chat|the OpenAI-compatible chat completions harness"
  "area:ahi|the Agent Host Interface extension for agent-to-agent invocation"
  "area:shared|the private shared Hono lifecycle and serve glue"
  "area:demo|runnable example agents and bundles"
  "area:docs|documentation content and package references"
  "area:dx|CI, toolchain, lint/format rules, root config"
)

for entry in "${AREAS[@]}"; do
  name="${entry%%|*}"
  desc="${entry#*|}"
  gh label create "$name" --repo "$REPO" --color "$AREA_COLOR" --description "$desc" --force
done

gh label create "on-hold" --repo "$REPO" --color "$HOLD_COLOR" \
  --description "Shaped work deliberately parked; not low priority, not blocked-by a specific issue" --force

gh label create "needs-triage" --repo "$REPO" --color "$TRIAGE_COLOR" \
  --description "Enforcer-managed: missing an area label or an Issue Type. Never hand-apply." --force

echo "Label taxonomy synced to $REPO."
