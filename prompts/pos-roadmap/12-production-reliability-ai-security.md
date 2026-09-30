# Implement production reliability, monitoring, and AI security

## Goal

Operate a live till safely and make failures actionable.

## Build

Add authenticated/rate-limited AI routes, provider health/fallback policy, error monitoring, structured logs without secrets, CI, E2E checkout/return/shift tests, backup/restore runbook, migration rollout plan, and incident procedures.

## Preserve

AI is advisory and can never bypass server-side POS permissions or invent transaction data. Keep all secrets server-only.

## Acceptance

- Provider quota/outage degrades clearly without blocking core checkout.
- Alerts cover checkout/RPC failures, sync backlog, and backup failures.
- CI gates typecheck, tests, migration validation, and critical E2E flows.
- Recovery exercises are documented and repeatable.
